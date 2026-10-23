import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { assertNotSelfReview } from '../../common/utils/versioning.util';
import { BillingReadinessService, BillingReadinessStatus } from '../billing-readiness/billing-readiness.service';
import { BillingCycleService } from '../billing-cycle/billing-cycle.service';
import { BillingManagementService } from '../billing-management/billing-management.service';
import { BillingCycleMaster } from '../billing-cycle/entities/billing-cycle-master.entity';
import { Property } from '../property/entities/property.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { User } from '../user/entities/user.entity';
import { WorkflowType } from '../workflow/dto/workflow.dto';
import { WorkflowOrchestrationService } from '../workflow/workflow-orchestration.service';
import { BillRun, BillRunStatus } from './entities/bill-run.entity';
import { BillRunBatch } from './entities/bill-run-batch.entity';
import {
  BillRunQueryDto,
  PastBillingOverviewQueryDto,
  PastBillingOverviewStatus,
  RejectBillRunDto,
  ResubmitBillRunDto,
  ReturnBillRunDto,
  ReviewBillRunDto,
  SubmitBatchBillRunDto,
  SubmitBillRunDto,
} from './dto/bill-run.dto';

const BILL_RUN_AUDIT_MODULE = 'BillRun';

// Statuses that mean "this property+cycle already has a live request" — a new submission must be
// blocked while one of these exists. Deliberately excludes RETURNED_FOR_CORRECTION/REJECTED: those
// are exactly the two statuses a fresh correct-and-resubmit is supposed to replace.
const ACTIVE_BILL_RUN_STATUSES = [BillRunStatus.PENDING_APPROVAL, BillRunStatus.APPROVED];

const RESPONSE_RELATIONS = ['property', 'property.community', 'cycleMaster', 'cycleVersion', 'submittedBy', 'reviewedBy', 'batch', 'resubmittedFrom'];

// 1:1, exhaustive (Record<BillRunStatus, ...> forces a compile error if BillRunStatus ever gains a
// value this doesn't handle) — Global Past Billing Overview's overviewStatus for a row with an
// EXISTING bill run always equals that bill run's own real status by name. Never collapse
// REJECTED/RETURNED_FOR_CORRECTION into PENDING_APPROVAL: a past fix for exactly that bug is why
// this map exists instead of an if/else chain.
const BILL_RUN_STATUS_TO_OVERVIEW_STATUS: Record<BillRunStatus, PastBillingOverviewStatus> = {
  [BillRunStatus.PENDING_APPROVAL]: PastBillingOverviewStatus.PENDING_APPROVAL,
  [BillRunStatus.RETURNED_FOR_CORRECTION]: PastBillingOverviewStatus.RETURNED_FOR_CORRECTION,
  [BillRunStatus.REJECTED]: PastBillingOverviewStatus.REJECTED,
  [BillRunStatus.APPROVED]: PastBillingOverviewStatus.APPROVED,
};

export interface BillRunValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

@Injectable()
export class BillRunService {
  private readonly logger = new Logger(BillRunService.name);

  constructor(
    @InjectRepository(BillRun) private readonly billRuns: Repository<BillRun>,
    @InjectRepository(BillRunBatch) private readonly billRunBatches: Repository<BillRunBatch>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(MeterReading) private readonly meterReadings: Repository<MeterReading>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(BillingCycleMaster) private readonly billingCycleMasters: Repository<BillingCycleMaster>,
    private readonly billingReadiness: BillingReadinessService,
    private readonly billingCycleService: BillingCycleService,
    private readonly billingManagement: BillingManagementService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly workflowOrchestration: WorkflowOrchestrationService,
  ) {
    // Registers this service's own approve() as the AUTO_APPROVE handler for BILL_RUN workflows —
    // see WorkflowOrchestrationService.registerAutoApproveHandler's own doc comment for why this
    // direction (domain -> workflow) replaced an earlier forwardRef()-based module import.
    this.workflowOrchestration.registerAutoApproveHandler(WorkflowType.BILL_RUN, (id) =>
      this.approve(id, { notes: 'Auto-approved by system — SLA breached, no human action taken on this level.' }, undefined, true).then(() => undefined),
    );
  }

  /** The exact same 5 checks the Bill Run UI shows as "Pre-Bill Validation" — computed from the
   *  SAME live BillingReadinessService.getReadiness() call the Billing Readiness screen itself
   *  uses, never a second, parallel readiness calculation. `tariff_assigned` here is a REAL check
   *  (unlike the Template's own hardcoded-pass placeholder) since BillingReadinessService already
   *  computes `unitsMissingTariff` for exactly this purpose. */
  async getValidationChecks(propertyId: number): Promise<{ checks: BillRunValidationCheck[]; allPassed: boolean; readiness: Awaited<ReturnType<BillingReadinessService['getReadiness']>>[number] | null }> {
    const [readiness] = await this.billingReadiness.getReadiness({ propertyId });
    if (!readiness) {
      return {
        checks: [{ id: 'property_exists', label: 'Property exists', passed: false, detail: 'Property not found' }],
        allPassed: false,
        readiness: null,
      };
    }

    const cycleClosed = !readiness.reasons.includes('no_billing_cycle' as any) && !readiness.reasons.includes('cycle_not_closed' as any);
    const billingReady = readiness.status === BillingReadinessStatus.READY;
    const noCriticalOrHigh = readiness.criticalAnomalies === 0 && readiness.highAnomalies === 0;
    const tariffAssigned = readiness.unitsMissingTariff === 0;
    // Scoped by cycleVersionId — matching submitWithinTransaction's own real duplicate-prevention
    // lock exactly (see that method's pessimistic_write query). Without this scope, an approved bill
    // run from a PAST, different cycle version (e.g. one submitted while an earlier
    // BillingCycleVersion was briefly current) would wrongly display as "already approved for this
    // property and cycle" even though submitWithinTransaction would not actually block a new
    // submission for the CURRENT version — a real, confirmed display/enforcement mismatch this fixes.
    // readiness.cycleVersionId is null only when no cycle is configured, in which case there is no
    // current version to check a duplicate against anyway (cycle_closed already fails that case).
    const activeExisting = readiness.cycleVersionId != null
      ? await this.billRuns.findOne({
          where: { propertyId, cycleVersionId: readiness.cycleVersionId, status: In(ACTIVE_BILL_RUN_STATUSES) },
        })
      : null;
    const noDuplicate = !activeExisting;

    // Read-only, messaging-only lookup — never consulted by the actual gate above or by
    // BillingManagementService's bill-amount calculation, which both remain scoped exclusively to
    // readiness.cyclePeriodStart/End. This exists so a property with unitsMissingReading > 0 that
    // DOES have real readings on file (just dated outside the current cycle window — e.g. a reading
    // that matched a now-deprecated prior BillingCycleVersion) tells the user that explicitly,
    // instead of leaving them to wonder whether "missing" means "never submitted" or "submitted for
    // the wrong period." DATE_FORMAT is used deliberately (not a raw column/Date comparison) — see
    // this codebase's own established note on the MySQL-driver UTC-shift read bug elsewhere
    // (SftpCronService).
    let outOfCycleReadingDate: string | null = null;
    if (readiness.unitsMissingReading > 0 && readiness.cyclePeriodStart && readiness.cyclePeriodEnd) {
      const latest = await this.meterReadings
        .createQueryBuilder('r')
        .select("DATE_FORMAT(r.reading_date, '%Y-%m-%d')", 'readingDate')
        .where('r.property_id = :propertyId', { propertyId })
        .andWhere('(r.reading_date < :periodStart OR r.reading_date > :periodEnd)', {
          periodStart: readiness.cyclePeriodStart,
          periodEnd: readiness.cyclePeriodEnd,
        })
        .orderBy('r.reading_date', 'DESC')
        .limit(1)
        .getRawOne<{ readingDate: string }>();
      outOfCycleReadingDate = latest?.readingDate ?? null;
    }

    const checks: BillRunValidationCheck[] = [
      {
        id: 'cycle_closed',
        label: 'Billing cycle closed',
        passed: cycleClosed,
        detail: cycleClosed
          ? `Billing cycle closed — ${readiness.cyclePeriodEnd}`
          : readiness.reasons.includes('no_billing_cycle' as any)
            ? 'No billing cycle configured for this property'
            : `Billing cycle has not closed yet — closes ${readiness.cyclePeriodEnd}`,
      },
      {
        id: 'billing_ready',
        label: 'Billing readiness',
        passed: billingReady,
        detail: billingReady
          ? 'Property is Ready for billing'
          : outOfCycleReadingDate
            // Explicit, so "Not Ready" never reads as "nothing was ever submitted" when a real
            // reading exists on file — just for a different, now-irrelevant period (a prior,
            // deprecated billing-cycle version, a one-off historical entry, etc.). This never
            // changes what "Not Ready" blocks — readiness.status and the actual submit gate above
            // are untouched.
            ? `Property is ${readiness.status === BillingReadinessStatus.ON_HOLD ? 'On Hold' : 'Not Ready'} — ${readiness.unitsMissingReading} unit(s) missing a reading for the current cycle (${readiness.cyclePeriodStart} to ${readiness.cyclePeriodEnd}). A reading exists on file dated ${outOfCycleReadingDate}, but it falls outside this cycle and cannot be used to bill it — resolve outstanding issues first`
            : `Property is ${readiness.status === BillingReadinessStatus.ON_HOLD ? 'On Hold' : 'Not Ready'} — resolve outstanding issues first`,
      },
      {
        id: 'no_critical_or_high_anomaly',
        label: 'No unresolved critical/high anomalies',
        passed: noCriticalOrHigh,
        detail: noCriticalOrHigh
          ? 'No unresolved critical or high-severity anomalies'
          : `${readiness.criticalAnomalies + readiness.highAnomalies} critical/high anomal${readiness.criticalAnomalies + readiness.highAnomalies === 1 ? 'y' : 'ies'} unresolved — resolve before billing`,
      },
      {
        id: 'tariff_assigned',
        label: 'Active tariff assigned to all billable units',
        passed: tariffAssigned,
        detail: tariffAssigned
          ? 'Every billable unit has an active tariff'
          : `${readiness.unitsMissingTariff} unit(s) missing an active tariff`,
      },
      {
        id: 'no_duplicate',
        label: 'No duplicate bill run for this cycle',
        passed: noDuplicate,
        detail: noDuplicate
          ? 'No active bill run already exists for this property and cycle'
          : `A bill run (${activeExisting!.businessCode ?? '#' + activeExisting!.id}) is already ${activeExisting!.status.replace(/_/g, ' ')} for this property and cycle`,
      },
    ];

    return { checks, allPassed: checks.every((c) => c.passed), readiness };
  }

  /** Submits one property's Bill Run. Re-validates everything server-side inside the SAME
   *  transaction that inserts the row — the frontend's own validation display is a courtesy, never
   *  the enforcement boundary, per this feature's explicit backend-enforces-everything requirement.
   *  The duplicate-check-then-insert is what actually needs the transaction: two concurrent
   *  submissions for the same property+cycle must not both pass the check before either commits.
   *
   *  dto.readingDate (Missed Reading Recovery, optional): when supplied, routes this submission
   *  through the recovery path (see submitWithinTransaction's own doc comment) instead of the
   *  routine current-cycle one. Omitted, this call is byte-for-byte the prior routine behavior. */
  async submit(dto: SubmitBillRunDto, actorId?: number): Promise<BillRun> {
    return this.dataSource.transaction(async (manager) => {
      const created = await this.submitWithinTransaction(
        manager,
        dto.propertyId,
        dto.notes,
        null,
        actorId,
        dto.readingDate ? { readingDate: dto.readingDate, occupantVerificationConfirmed: !!dto.occupantVerificationConfirmed } : undefined,
      );
      await this.auditService.record(
        { moduleName: BILL_RUN_AUDIT_MODULE, entityId: created.id, action: 'SUBMIT', newValue: { propertyId: dto.propertyId, status: created.status, readingDate: dto.readingDate ?? null }, performedBy: actorId },
        manager,
      );
      return created;
    }).then((created) => this.findOne(created.id));
  }

  /** Submits a batch — every property is independently re-validated (batch never bypasses a single
   *  property's own checks: a property that fails validation is skipped, not force-included), all
   *  inside one transaction so the batch and its member runs are created atomically. Returns which
   *  properties succeeded and which were skipped with their specific failure reason, mirroring the
   *  Template's own "batch shows why each skipped property failed" UX rather than silently dropping
   *  them or failing the whole batch for one bad property. */
  async submitBatch(dto: SubmitBatchBillRunDto, actorId?: number): Promise<{
    batch: BillRunBatch;
    submitted: BillRun[];
    skipped: { propertyId: number; propertyName: string; reason: string }[];
  }> {
    const uniquePropertyIds = [...new Set(dto.propertyIds)];

    return this.dataSource.transaction(async (manager) => {
      const batchEntity = manager.create(BillRunBatch, {
        submittedById: actorId ?? null,
        submittedOn: new Date(),
        notes: dto.notes ?? null,
      });
      let batch = await manager.save(BillRunBatch, batchEntity);
      batch.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.BILLING_RUN, batch.id);
      batch = await manager.save(BillRunBatch, batch);

      const submitted: BillRun[] = [];
      const skipped: { propertyId: number; propertyName: string; reason: string }[] = [];

      // Sequential, not Promise.all — each submission's own duplicate-check must see the previous
      // one's insert within this same transaction (two properties in one batch could otherwise race
      // each other the same way two separate concurrent requests could).
      for (const propertyId of uniquePropertyIds) {
        try {
          const created = await this.submitWithinTransaction(manager, propertyId, dto.notes, batch.id, actorId);
          submitted.push(created);
        } catch (err) {
          const property = await manager.findOne(Property, { where: { id: propertyId } });
          skipped.push({
            propertyId,
            propertyName: property?.name ?? `Property #${propertyId}`,
            reason: err instanceof Error ? err.message : 'Validation failed',
          });
        }
      }

      if (submitted.length === 0) {
        throw new BadRequestException(
          `No properties in this batch passed validation: ${skipped.map((s) => `${s.propertyName} (${s.reason})`).join('; ')}`,
        );
      }

      await this.auditService.record(
        { moduleName: BILL_RUN_AUDIT_MODULE, entityId: batch.id, action: 'SUBMIT_BATCH', newValue: { submittedCount: submitted.length, skippedCount: skipped.length }, performedBy: actorId },
        manager,
      );

      return { batch, submitted, skipped };
    });
  }

  /** Shared by submit() and submitBatch() — the ONE place a BillRun row is ever created, so the
   *  validation-then-insert logic can never drift between the individual and batch entry points.
   *
   *  `recovery` (Missed Reading Recovery, optional) — when supplied, this submission targets an
   *  explicit past reading date instead of the property's current cycle. The caller (submit())
   *  NEVER passes a client-supplied cycleVersionId or period directly here — only the reading's own
   *  date — because resolveVersionForReadingDate (called below) is what actually determines the
   *  version/period server-side; trusting a client-chosen version/date pair without this resolution
   *  step would let a caller silently target an unrelated, possibly-invalid cycle. Every check below
   *  (readiness equivalent, tariff, duplicate, occupancy) reuses the EXISTING, already-tested
   *  checkRecoveredReadingEligibility exactly as-is — this method adds no new readiness logic of its
   *  own, only the branch that routes to it and the insert that follows. When `recovery` is omitted,
   *  every line below this comment through the routine cycleInfo branch is UNCHANGED from before this
   *  feature existed. */
  private async submitWithinTransaction(
    manager: DataSource['manager'],
    propertyId: number,
    notes: string | undefined,
    batchId: number | null,
    actorId?: number,
    recovery?: { readingDate: string; occupantVerificationConfirmed: boolean },
  ): Promise<BillRun> {
    let cycleMasterId: number;
    let cycleVersionId: number;
    let periodStart: string;
    let periodEnd: string;
    let billableUnits: number;
    let unitsMissingTariff: number;
    let unitsMissingMeterMapping: number;
    let unitsMissingReading: number;
    let criticalAnomalies: number;
    let highAnomalies: number;

    if (recovery) {
      // Recovery path — resolves the version/period from the reading date itself, server-side, and
      // reuses the existing, already-tested eligibility check for every real validation (readings,
      // tariff-as-of-date, duplicate bill run for this exact version, occupancy). Never re-derives
      // any of this independently.
      const eligibility = await this.billingReadiness.checkRecoveredReadingEligibility(propertyId, recovery.readingDate);
      if (eligibility.resolution !== 'resolved' || eligibility.cycleVersionId === null) {
        throw new BadRequestException(
          eligibility.blockingReasons[0] ?? `Could not resolve a billing-cycle version for ${recovery.readingDate}`,
        );
      }
      // checkRecoveredReadingEligibility's own occupantVerificationRequired is unconditionally true
      // for every unit (informational — it does not feed eligibility.blockingReasons/eligibleForBilling
      // itself; see that method's own doc comment on why). THIS is the actual enforcement point: a
      // past-period submission is refused unless the submitter explicitly attests the current
      // occupant is confirmed correct for the historical period — never silently assumed.
      if (!recovery.occupantVerificationConfirmed) {
        throw new BadRequestException(
          'Historical occupant verification is required before a past-period bill run can be submitted — confirm the current occupant is correct for this period and resubmit with occupantVerificationConfirmed=true',
        );
      }
      if (!eligibility.eligibleForBilling) {
        throw new BadRequestException(eligibility.blockingReasons.join('; ') || 'This period is not eligible for billing');
      }

      cycleMasterId = (await this.billingCycleService.getHistoricalVersionsForProperty(propertyId))
        .find((v) => v.versionId === eligibility.cycleVersionId)?.masterId
        // getHistoricalVersionsForProperty only lists DEPRECATED versions — a version that is still
        // the property's CURRENT one (Grand Tower A's version 22 is exactly this case) won't be in
        // that list, so fall back to the live current-cycle lookup for its masterId only (never its
        // period, which would be today-anchored — periodStart/periodEnd below always come from
        // eligibility, not from this fallback).
        ?? (await this.billingCycleService.getReadingPeriodForProperty(propertyId))?.masterId
        ?? null as unknown as number;
      if (!cycleMasterId) throw new BadRequestException('Could not resolve a billing-cycle master for this property');
      cycleVersionId = eligibility.cycleVersionId;
      periodStart = eligibility.periodStart;
      periodEnd = eligibility.periodEnd;
      billableUnits = eligibility.units.length;
      unitsMissingTariff = eligibility.units.filter((u) => u.tariffStatus !== 'resolved').length;
      unitsMissingMeterMapping = eligibility.units.filter((u) => !u.meterBusinessCode).length;
      unitsMissingReading = eligibility.missingReadingMeterIds.length;
      // Recovery eligibility deliberately does not compute anomaly counts (evaluateHistoricalCycle's
      // own return shape has no critical/high fields) — a past period's anomaly state is not
      // re-derived here; this is recorded as 0, matching "no NEW anomaly check ran for this path,"
      // never implying anomalies were checked and found clean.
      criticalAnomalies = 0;
      highAnomalies = 0;
    } else {
      // Routine path — UNCHANGED from before this feature existed.
      const [readiness] = await this.billingReadiness.getReadiness({ propertyId });
      if (!readiness) throw new NotFoundException('Property not found');
      if (readiness.status !== BillingReadinessStatus.READY) {
        throw new BadRequestException(`Property is ${readiness.status === BillingReadinessStatus.ON_HOLD ? 'On Hold' : 'Not Ready'} — resolve outstanding readiness issues before submitting a bill run`);
      }

      const cycleInfo = await this.billingCycleService.getReadingPeriodForProperty(propertyId);
      if (!cycleInfo) throw new BadRequestException('No billing cycle configured for this property');
      if (!cycleInfo.closed) throw new BadRequestException('The billing cycle has not closed yet');

      cycleMasterId = cycleInfo.masterId;
      cycleVersionId = cycleInfo.versionId;
      periodStart = cycleInfo.periodStart;
      periodEnd = cycleInfo.periodEnd;
      billableUnits = readiness.billableUnits;
      unitsMissingTariff = readiness.unitsMissingTariff;
      unitsMissingMeterMapping = readiness.unitsMissingMeterMapping;
      unitsMissingReading = readiness.unitsMissingReading;
      criticalAnomalies = readiness.criticalAnomalies;
      highAnomalies = readiness.highAnomalies;
    }

    // Row lock inside the transaction — the real duplicate-prevention guard, same for both paths. A
    // plain pre-check without this would let two concurrent requests both see "no active run" and
    // both insert. (checkRecoveredReadingEligibility's own existingBillRun check above is a courtesy
    // report for ANY prior status — this lock is the actual, narrower enforcement, matching the
    // routine path's own ACTIVE_BILL_RUN_STATUSES scope exactly, so a rejected/returned recovery
    // attempt can still be corrected and resubmitted the same way a routine one can.)
    const existingActive = await manager
      .createQueryBuilder(BillRun, 'br')
      .setLock('pessimistic_write')
      .where('br.property_id = :propertyId', { propertyId })
      .andWhere('br.cycle_version_id = :versionId', { versionId: cycleVersionId })
      .andWhere('br.status IN (:...statuses)', { statuses: ACTIVE_BILL_RUN_STATUSES })
      .getOne();
    if (existingActive) {
      throw new ConflictException(
        `A bill run (${existingActive.businessCode ?? '#' + existingActive.id}) already exists for this property and cycle`,
      );
    }

    const submittedOn = new Date();
    const addDays = (dateStr: string, days: number) => {
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    // billGenerationDays/billIssueDays/billDueDays are version-level CONFIGURATION, not something
    // either path above resolves independently — read directly here so the recovery path's issue/due
    // dates use the SAME version config a routine submission for this version would, without
    // duplicating that lookup inside the recovery branch above.
    const versionConfig = await this.billingCycleService.getVersionDayConfig(cycleVersionId);
    const billGenerationDays = versionConfig?.billGenerationDays ?? 0;
    const billIssueDays = versionConfig?.billIssueDays ?? 0;
    const billDueDays = versionConfig?.billDueDays ?? 1;

    const entity = manager.create(BillRun, {
      batchId,
      propertyId,
      cycleMasterId,
      cycleVersionId,
      cyclePeriodStart: periodStart,
      cyclePeriodEnd: periodEnd,
      billIssueDate: addDays(periodEnd, billGenerationDays + billIssueDays),
      billDueDate: addDays(periodEnd, billGenerationDays + billIssueDays + billDueDays),
      status: BillRunStatus.PENDING_APPROVAL,
      billableUnits,
      unitsMissingTariff,
      unitsMissingMeterMapping,
      unitsMissingReading,
      criticalAnomalies,
      highAnomalies,
      // NULL for a routine submission — only set for recovery, where it is always the SAME value as
      // periodStart (see the entity field's own doc comment for exactly what this feeds).
      tariffResolutionDate: recovery ? periodStart : null,
      notes: notes ?? null,
      submittedById: actorId ?? null,
      submittedOn,
    });
    let saved = await manager.save(BillRun, entity);
    saved.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.BILLING_RUN, saved.id);
    saved = await manager.save(BillRun, saved);
    await this.workflowOrchestration.startInstance(WorkflowType.BILL_RUN, saved.id, actorId, manager);
    return saved;
  }

  async findAll(query: BillRunQueryDto) {
    const qb = this.billRuns
      .createQueryBuilder('br')
      .leftJoinAndSelect('br.property', 'property')
      .leftJoinAndSelect('property.community', 'community')
      .leftJoinAndSelect('br.cycleMaster', 'cycleMaster')
      .leftJoinAndSelect('br.cycleVersion', 'cycleVersion')
      .leftJoinAndSelect('br.submittedBy', 'submittedBy')
      .leftJoinAndSelect('br.reviewedBy', 'reviewedBy')
      .leftJoinAndSelect('br.batch', 'batch');

    if (query.propertyId) qb.andWhere('br.property_id = :propertyId', { propertyId: query.propertyId });
    if (query.communityId) qb.andWhere('community.id = :communityId', { communityId: query.communityId });
    if (query.batchId) qb.andWhere('br.batch_id = :batchId', { batchId: query.batchId });
    if (query.status) qb.andWhere('br.status = :status', { status: query.status });
    if (query.search) qb.andWhere('(br.business_code LIKE :s OR property.property_name LIKE :s)', { s: `%${query.search}%` });
    if (query.periodFrom) qb.andWhere('br.cycle_period_start >= :periodFrom', { periodFrom: query.periodFrom });
    if (query.periodTo) qb.andWhere('br.cycle_period_start <= :periodTo', { periodTo: query.periodTo });

    // TypeORM's query builder .orderBy() needs the entity's own camelCase property path (e.g.
    // 'br.createdAt'), not the raw snake_case DB column name — using the raw column name here broke
    // alias resolution inside TypeORM's own createOrderByCombinedWithSelectExpression once combined
    // with the joins + getManyAndCount() pagination (a real crash, not a stylistic nitpick).
    const SORTABLE: Record<string, string> = {
      createdAt: 'br.createdAt',
      submittedOn: 'br.submittedOn',
      status: 'br.status',
    };
    qb.orderBy(SORTABLE[query.sortBy ?? ''] ?? 'br.submittedOn', query.sortOrder === 'ASC' ? 'ASC' : 'DESC');

    return paginate(qb, query);
  }

  async findOne(id: number): Promise<BillRun> {
    const billRun = await this.billRuns.findOne({ where: { id }, relations: RESPONSE_RELATIONS });
    if (!billRun) throw new NotFoundException('Bill run not found');
    return billRun;
  }

  /** Real, multi-event approval-history timeline for ONE BillRun — sourced entirely from the
   *  existing AuditLog rows this service already writes on SUBMIT/SUBMIT_BATCH/APPROVE/REJECT/
   *  RETURN/RESUBMIT (see each method's own auditService.record call above). The BillRun row itself
   *  only ever holds the LATEST review outcome (one reviewedById/reviewedOn/reviewNotes triple) —
   *  this is the only way to show every event in order, not just the most recent one. Returns the
   *  raw audit rows with oldValue/newValue JSON-parsed (each action type stores a genuinely
   *  different shape — APPROVE/REJECT/RETURN store the whole pre/post BillRun entity, SUBMIT/
   *  RESUBMIT store a narrow hand-picked object — never normalized into one artificial shape here,
   *  since doing so risks misrepresenting what a given event actually recorded) and performedBy
   *  resolved to a real user name where one exists — never a live re-check, never fabricated. */
  async getApprovalHistory(id: number): Promise<Array<{
    id: number;
    action: string;
    createdAt: Date;
    performedBy: { id: number; firstName?: string; lastName?: string } | null;
    oldValue: unknown;
    newValue: unknown;
  }>> {
    const exists = await this.billRuns.findOne({ where: { id }, select: ['id'] });
    if (!exists) throw new NotFoundException('Bill run not found');

    const events = await this.auditService.findByModuleAndEntity(BILL_RUN_AUDIT_MODULE, id);

    const performerIds = [...new Set(events.map((e) => e.performedBy).filter((id): id is number => id != null))];
    const performers = performerIds.length
      ? await this.users.find({ where: { id: In(performerIds) }, select: ['id', 'firstName', 'lastName'] })
      : [];
    const performerById = new Map(performers.map((u) => [u.id, u]));

    return events.map((e) => ({
      id: e.id,
      action: e.action,
      createdAt: e.createdAt,
      performedBy: e.performedBy != null ? (performerById.get(e.performedBy) ?? { id: e.performedBy }) : null,
      oldValue: e.oldValue ? JSON.parse(e.oldValue) : null,
      newValue: e.newValue ? JSON.parse(e.newValue) : null,
    }));
  }

  async getBatchSummary(batchId: number) {
    const batch = await this.billRunBatches.findOne({ where: { id: batchId }, relations: ['submittedBy'] });
    if (!batch) throw new NotFoundException('Bill run batch not found');
    const members = await this.billRuns.find({ where: { batchId }, relations: RESPONSE_RELATIONS });
    return { batch, members };
  }

  /** Global Past Billing Overview — one row per (property, historical cycle version), estate-wide.
   *  Reuses existing, already-tested logic exclusively: BillingCycleService.getHistoricalVersionsForProperty
   *  for which periods a property ever missed its CURRENT cycle, and BillingReadinessService.
   *  evaluateHistoricalCycle for whether each one is actually eligible/blocked/already billed — the
   *  exact same methods Missed Reading Recovery already relies on. No new billing/eligibility rule is
   *  introduced here; this method is pure orchestration across properties, which is the one thing
   *  neither existing method does (both are single-property).
   *
   *  Why this can't be discovered from BillRun rows alone (see this method's own controller route
   *  doc): a MISSING period has, by definition, no BillRun row to query — it only exists as a
   *  DEPRECATED BillingCycleVersion with no corresponding BillRun for (propertyId, cycleVersionId).
   *  Starting from BillRun and working backwards can only ever find periods that already got a
   *  request; it structurally cannot surface the gap this feature exists to find.
   *
   *  Pagination is done at the (property, version) ROW level, not the property level: the real
   *  per-unit evaluation (evaluateHistoricalCycle) only ever runs for the current page's rows, never
   *  the full estate on every request — this bounds the per-request fan-out to `limit` (default 20,
   *  same as every other paginated list in this codebase) regardless of how many properties/
   *  historical versions exist overall. */
  async getPastBillingOverview(query: PastBillingOverviewQueryDto): Promise<PaginatedResult<{
    propertyId: number;
    propertyName: string;
    propertyCode: string | null;
    communityId: number;
    communityName: string;
    cycleVersionId: number;
    periodStart: string;
    periodEnd: string;
    ageDays: number;
    overviewStatus: PastBillingOverviewStatus;
    blockingReasons: string[];
    existingBillRun: { id: number; businessCode: string | null; status: BillRunStatus } | null;
    billableUnits: number;
    generatedBillCount: number | null;
  }>> {
    const masterQb = this.billingCycleMasters
      .createQueryBuilder('m')
      .innerJoin('m.property', 'property')
      .innerJoin('property.community', 'community')
      .where('property.deleted_at IS NULL');
    if (query.propertyId) masterQb.andWhere('m.property_id = :propertyId', { propertyId: query.propertyId });
    if (query.communityId) masterQb.andWhere('community.id = :communityId', { communityId: query.communityId });

    const masters: Array<{ propertyId: number; propertyName: string; propertyCode: string | null; communityId: number; communityName: string }> =
      await masterQb
        .select('property.id', 'propertyId')
        .addSelect('property.property_name', 'propertyName')
        .addSelect('property.property_code', 'propertyCode')
        .addSelect('community.id', 'communityId')
        .addSelect('community.name', 'communityName')
        .getRawMany();

    // Every (property, historical version) pair, across the whole estate — real data only, never a
    // hardcoded month/property list, per this feature's own data-integrity requirement. One
    // getHistoricalVersionsForProperty call per property (cheap: one indexed query each, no per-unit
    // work) — the expensive per-unit evaluation happens ONLY for the current page's slice, below.
    type CandidateRow = {
      propertyId: number; propertyName: string; propertyCode: string | null;
      communityId: number; communityName: string;
      cycleVersionId: number; masterId: number; periodStart: string; periodEnd: string; ageDays: number;
    };
    const candidates: CandidateRow[] = [];
    for (const m of masters) {
      const historicalVersions = await this.billingCycleService.getHistoricalVersionsForProperty(m.propertyId);
      for (const v of historicalVersions) {
        if (query.periodFrom && v.periodStart < query.periodFrom) continue;
        if (query.periodTo && v.periodStart > query.periodTo) continue;
        candidates.push({
          propertyId: m.propertyId,
          propertyName: m.propertyName,
          propertyCode: m.propertyCode,
          communityId: m.communityId,
          communityName: m.communityName,
          cycleVersionId: v.versionId,
          masterId: v.masterId,
          periodStart: v.periodStart,
          periodEnd: v.periodEnd,
          ageDays: v.ageDays,
        });
      }
    }

    // Newest completed period first, matching the feature's own stated requirement — tie-broken by
    // property name for a stable, deterministic order across pages.
    candidates.sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.propertyName.localeCompare(b.propertyName));

    // overviewStatus requires knowing whether a BillRun already exists, which isn't known until
    // evaluateHistoricalCycle runs — so a status filter can't be pushed into the cheap candidate
    // query above. Evaluate every candidate's EXISTING-BILL-RUN/eligibility (the full per-unit check
    // is unavoidable here to classify status correctly), filter, THEN paginate — this keeps the
    // result page-stable and correctly filtered at the cost of evaluating the full candidate set
    // once per request. Acceptable for the real property counts this system manages today; revisit
    // with a persisted summary if the estate grows large enough to make this slow.
    const evaluated = await Promise.all(candidates.map(async (c) => {
      const result = await this.billingReadiness.evaluateHistoricalCycle(c.propertyId, c.cycleVersionId, {
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        masterId: c.masterId,
      });

      // Exhaustive — an existing bill run's real status maps 1:1 onto an overviewStatus of the same
      // name (BILL_RUN_STATUS_TO_OVERVIEW_STATUS below) so REJECTED/RETURNED_FOR_CORRECTION are
      // never silently relabeled as "still pending." Only when there is NO existing bill run at all
      // does this fall through to the eligibility check, which has no BillRunStatus equivalent.
      //
      // The cast below is safe, not a type-safety shortcut: evaluateHistoricalCycle's own
      // existingBillRun.status is typed `string` only because that method's return shape predates
      // this feature and was never tightened — the actual runtime value always comes straight from
      // BillRun.status (a real BillRunStatus column), confirmed by reading its query directly
      // (billing-readiness.service.ts's own `this.billRuns.findOne(...)` call).
      let overviewStatus: PastBillingOverviewStatus;
      if (result.existingBillRun) overviewStatus = BILL_RUN_STATUS_TO_OVERVIEW_STATUS[result.existingBillRun.status as BillRunStatus];
      else if (result.eligibleForBilling) overviewStatus = PastBillingOverviewStatus.MISSING_BILL_RUN;
      else overviewStatus = PastBillingOverviewStatus.BLOCKED;

      // Approval alone never proves Bills were generated — only a real count of persisted Bill rows
      // does. Reuses BillingManagementService.getSummary (the same real aggregate
      // BillingHistoryView's own "Generated Bills" count already relies on) rather than a second,
      // parallel Bill query. Only queried for an APPROVED run (the one status where generation is
      // even expected to have run); every other status leaves this null, never 0, so the UI can
      // distinguish "not applicable" from "confirmed zero."
      let generatedBillCount: number | null = null;
      if (overviewStatus === PastBillingOverviewStatus.APPROVED && result.existingBillRun) {
        const billSummary = await this.billingManagement.getSummary({ billRunId: result.existingBillRun.id });
        generatedBillCount = billSummary.totalBills;
      }

      return {
        propertyId: c.propertyId,
        propertyName: c.propertyName,
        propertyCode: c.propertyCode,
        communityId: c.communityId,
        communityName: c.communityName,
        cycleVersionId: c.cycleVersionId,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        ageDays: c.ageDays,
        overviewStatus,
        blockingReasons: result.blockingReasons,
        existingBillRun: result.existingBillRun as { id: number; businessCode: string | null; status: BillRunStatus } | null,
        billableUnits: result.units.length,
        generatedBillCount,
      };
    }));

    const filtered = query.overviewStatus
      ? evaluated.filter((r) => r.overviewStatus === query.overviewStatus)
      : evaluated;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Real, estate-wide summary counts for the Global Past Billing Overview's own stat cards — derived
   *  from the SAME evaluation getPastBillingOverview uses, never a separate/cheaper approximation
   *  that could disagree with what the table itself shows. Unpaginated by design (a count, not a
   *  list) but still scoped by the same property/community/period filters so the cards match
   *  whatever the table is currently filtered to. */
  async getPastBillingOverviewSummary(query: Pick<PastBillingOverviewQueryDto, 'propertyId' | 'communityId' | 'periodFrom' | 'periodTo'>): Promise<{
    missingBillRun: number;
    blocked: number;
    pendingApproval: number;
    approved: number;
    // Additive, real counts for the 2 BillRunStatus values the 4 headline cards don't have a slot
    // for — never silently folded into pendingApproval/blocked (that was exactly the earlier bug in
    // getPastBillingOverview's own status mapping). Surfaced here so the UI can choose to show them
    // rather than let them vanish from every total.
    returnedForCorrection: number;
    rejected: number;
    totalPeriods: number;
  }> {
    const full = await this.getPastBillingOverview({ ...query, page: 1, limit: 100000 });
    const counts = { missingBillRun: 0, blocked: 0, pendingApproval: 0, approved: 0, returnedForCorrection: 0, rejected: 0 };
    for (const row of full.items) {
      if (row.overviewStatus === PastBillingOverviewStatus.MISSING_BILL_RUN) counts.missingBillRun += 1;
      else if (row.overviewStatus === PastBillingOverviewStatus.BLOCKED) counts.blocked += 1;
      else if (row.overviewStatus === PastBillingOverviewStatus.PENDING_APPROVAL) counts.pendingApproval += 1;
      else if (row.overviewStatus === PastBillingOverviewStatus.APPROVED) counts.approved += 1;
      else if (row.overviewStatus === PastBillingOverviewStatus.RETURNED_FOR_CORRECTION) counts.returnedForCorrection += 1;
      else if (row.overviewStatus === PastBillingOverviewStatus.REJECTED) counts.rejected += 1;
    }
    return { ...counts, totalPeriods: full.pagination.total };
  }

  // `isSystemActor` — true ONLY from WorkflowSlaSchedulerService's AUTO_APPROVE path (the HTTP
  // controller never passes a 3rd argument). The scheduler passes dto.notes itself (e.g.
  // "Auto-approved by system — SLA breach..."), so recordApproval's notes already carry that
  // distinction without any special-casing here — see Tariff's own approve() for why that one
  // needed an inline note instead (its recordApproval call never threads dto.notes).
  async approve(id: number, dto: ReviewBillRunDto, actorId?: number, isSystemActor = false): Promise<BillRun> {
    const savedId = await this.dataSource.transaction(async (manager) => {
      // Workflow check runs FIRST, before the domain row is even locked — mirrors Tariff/Billing
      // Cycle. assertCanAct resolves the acting user's real active roles via UserRoleService (never
      // users.role_id) and confirms their role matches the CURRENT workflow level's configured
      // approver — a check that is entirely independent of, and in addition to, the
      // PermissionGuard/@Permission(BILL_RUN_APPROVE) check that already ran before this method was
      // ever called. If no workflow is configured for BILL_RUN, isFinalLevel is always true and
      // nothing below changes behavior.
      const workflowContext = await this.workflowOrchestration.assertCanAct(WorkflowType.BILL_RUN, id, actorId, manager, isSystemActor);

      const billRun = await manager
        .createQueryBuilder(BillRun, 'br')
        .setLock('pessimistic_write')
        .where('br.id = :id', { id })
        .getOne();
      if (!billRun) throw new NotFoundException('Bill run not found');
      if (billRun.status !== BillRunStatus.PENDING_APPROVAL) {
        throw new BadRequestException('Only a bill run pending approval can be approved');
      }
      assertNotSelfReview(billRun.submittedById, actorId, 'approved');

      const oldValue = { ...billRun };
      billRun.reviewedById = actorId ?? null;
      billRun.reviewedOn = new Date();
      billRun.reviewNotes = dto.notes ?? null;
      // Only the FINAL workflow level's approval actually moves the Bill Run to APPROVED — an
      // intermediate level's approval advances the workflow instance (recordApproval, below) without
      // changing the Bill Run's own domain status at all. The Bill Run stays PENDING_APPROVAL,
      // waiting on the next level, exactly as the domain's pre-Workflow behavior left it waiting on
      // the only level there used to be.
      if (workflowContext.isFinalLevel) {
        billRun.status = BillRunStatus.APPROVED;
      }
      const saved = await manager.save(BillRun, billRun);
      await this.workflowOrchestration.recordApproval(workflowContext, actorId, dto.notes, manager);
      await this.auditService.record({ moduleName: BILL_RUN_AUDIT_MODULE, entityId: id, action: 'APPROVE', oldValue, newValue: saved, performedBy: actorId }, manager);
      return saved.id;
    });

    const result = await this.findOne(savedId);

    // Deliberately called AFTER the transaction has already committed, never inside it — Bill Run
    // approval is Bill Run Request's own responsibility and must never be contingent on, rolled back
    // by, or otherwise coupled to Billing Management's outcome (see billing-management.service.ts's
    // own doc comment on this exact boundary). Gated on the Bill Run's actual resulting status, not
    // merely "approve() was called" — an intermediate workflow level's approval must NOT trigger bill
    // generation; only the approval that actually flips the Bill Run to APPROVED should (requirement:
    // final approval still triggers bill generation exactly once). Bill generation failures are
    // handled entirely inside generateBillsForBillRun itself (per-unit, non-fatal, recorded and
    // returned rather than thrown) — but as a final defensive boundary, a failure here is logged and
    // swallowed rather than allowed to make this approve() call appear to fail when the actual
    // approval action already succeeded.
    if (result.status === BillRunStatus.APPROVED) {
      try {
        await this.billingManagement.generateBillsForBillRun(result.id, actorId);
      } catch (err) {
        this.logger.error(`Bill generation failed after approving bill run ${result.id} — approval itself is unaffected`, err as Error);
      }
    }

    return this.findOne(id);
  }

  async reject(id: number, dto: RejectBillRunDto, actorId?: number): Promise<BillRun> {
    return this.dataSource.transaction(async (manager) => {
      const workflowContext = await this.workflowOrchestration.assertCanAct(WorkflowType.BILL_RUN, id, actorId, manager);

      const billRun = await manager
        .createQueryBuilder(BillRun, 'br')
        .setLock('pessimistic_write')
        .where('br.id = :id', { id })
        .getOne();
      if (!billRun) throw new NotFoundException('Bill run not found');
      if (billRun.status !== BillRunStatus.PENDING_APPROVAL) {
        throw new BadRequestException('Only a bill run pending approval can be rejected');
      }
      assertNotSelfReview(billRun.submittedById, actorId, 'rejected');

      const oldValue = { ...billRun };
      billRun.status = BillRunStatus.REJECTED;
      billRun.reviewedById = actorId ?? null;
      billRun.reviewedOn = new Date();
      billRun.reviewNotes = dto.notes;
      const saved = await manager.save(BillRun, billRun);
      // A rejection at ANY level ends the whole workflow — never gated on isFinalLevel. There is no
      // "reject just this level and continue" semantic; the configured levels are a sequence of
      // required approvals, and any one of them refusing is a terminal outcome for the instance.
      await this.workflowOrchestration.recordRejection(workflowContext, actorId, dto.notes, manager);
      await this.auditService.record({ moduleName: BILL_RUN_AUDIT_MODULE, entityId: id, action: 'REJECT', oldValue, newValue: saved, performedBy: actorId }, manager);
      return saved.id;
    }).then((savedId) => this.findOne(savedId));
  }

  async returnForCorrection(id: number, dto: ReturnBillRunDto, actorId?: number): Promise<BillRun> {
    return this.dataSource.transaction(async (manager) => {
      const workflowContext = await this.workflowOrchestration.assertCanAct(WorkflowType.BILL_RUN, id, actorId, manager);

      const billRun = await manager
        .createQueryBuilder(BillRun, 'br')
        .setLock('pessimistic_write')
        .where('br.id = :id', { id })
        .getOne();
      if (!billRun) throw new NotFoundException('Bill run not found');
      if (billRun.status !== BillRunStatus.PENDING_APPROVAL) {
        throw new BadRequestException('Only a bill run pending approval can be returned for correction');
      }
      assertNotSelfReview(billRun.submittedById, actorId, 'returned for correction');

      const oldValue = { ...billRun };
      billRun.status = BillRunStatus.RETURNED_FOR_CORRECTION;
      billRun.reviewedById = actorId ?? null;
      billRun.reviewedOn = new Date();
      billRun.reviewNotes = dto.notes;
      const saved = await manager.save(BillRun, billRun);
      // Returning for correction is also a terminal exit from the workflow's perspective — the
      // submitter must correct and resubmit via resubmit(), which creates a brand-new row and (via
      // submitWithinTransaction) starts a brand-new workflow instance from Level 1. The original
      // instance must not be left dangling mid-flight.
      await this.workflowOrchestration.recordRejection(workflowContext, actorId, dto.notes, manager);
      await this.auditService.record({ moduleName: BILL_RUN_AUDIT_MODULE, entityId: id, action: 'RETURN', oldValue, newValue: saved, performedBy: actorId }, manager);
      return saved.id;
    }).then((savedId) => this.findOne(savedId));
  }

  /** Corrects-and-resubmits a returned or rejected bill run as a brand NEW row — the original is
   *  never mutated, preserving it as real, immutable history (same principle as billing cycle's own
   *  resubmit, minus formal version numbering since Bill Run has no "edit these specific fields"
   *  concept the way a billing cycle configuration does — the only thing that could have changed
   *  between attempts is the underlying readiness data itself, which this re-validates fresh). */
  async resubmit(id: number, dto: ResubmitBillRunDto, actorId?: number): Promise<BillRun> {
    const original = await this.billRuns.findOne({ where: { id } });
    if (!original) throw new NotFoundException('Bill run not found');
    if (![BillRunStatus.RETURNED_FOR_CORRECTION, BillRunStatus.REJECTED].includes(original.status)) {
      throw new BadRequestException('Only a returned or rejected bill run can be resubmitted');
    }

    return this.dataSource.transaction(async (manager) => {
      const created = await this.submitWithinTransaction(manager, original.propertyId, dto.notes, original.batchId ?? null, actorId);
      created.resubmittedFromId = original.id;
      const saved = await manager.save(BillRun, created);
      await this.auditService.record(
        { moduleName: BILL_RUN_AUDIT_MODULE, entityId: saved.id, action: 'RESUBMIT', oldValue: { resubmittedFromId: original.id, previousStatus: original.status }, newValue: { status: saved.status }, performedBy: actorId },
        manager,
      );
      return saved;
    }).then((created) => this.findOne(created.id));
  }
}

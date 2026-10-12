import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { assertNotSelfReview } from '../../common/utils/versioning.util';
import { BillingReadinessService, BillingReadinessStatus } from '../billing-readiness/billing-readiness.service';
import { BillingCycleService } from '../billing-cycle/billing-cycle.service';
import { BillingManagementService } from '../billing-management/billing-management.service';
import { Property } from '../property/entities/property.entity';
import { WorkflowType } from '../workflow/dto/workflow.dto';
import { WorkflowOrchestrationService } from '../workflow/workflow-orchestration.service';
import { BillRun, BillRunStatus } from './entities/bill-run.entity';
import { BillRunBatch } from './entities/bill-run-batch.entity';
import {
  BillRunQueryDto,
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
    const activeExisting = await this.billRuns.findOne({
      where: { propertyId, status: In(ACTIVE_BILL_RUN_STATUSES) },
    });
    const noDuplicate = !activeExisting;

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
   *  submissions for the same property+cycle must not both pass the check before either commits. */
  async submit(dto: SubmitBillRunDto, actorId?: number): Promise<BillRun> {
    return this.dataSource.transaction(async (manager) => {
      const created = await this.submitWithinTransaction(manager, dto.propertyId, dto.notes, null, actorId);
      await this.auditService.record(
        { moduleName: BILL_RUN_AUDIT_MODULE, entityId: created.id, action: 'SUBMIT', newValue: { propertyId: dto.propertyId, status: created.status }, performedBy: actorId },
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
   *  validation-then-insert logic can never drift between the individual and batch entry points. */
  private async submitWithinTransaction(
    manager: DataSource['manager'],
    propertyId: number,
    notes: string | undefined,
    batchId: number | null,
    actorId?: number,
  ): Promise<BillRun> {
    const [readiness] = await this.billingReadiness.getReadiness({ propertyId });
    if (!readiness) throw new NotFoundException('Property not found');
    if (readiness.status !== BillingReadinessStatus.READY) {
      throw new BadRequestException(`Property is ${readiness.status === BillingReadinessStatus.ON_HOLD ? 'On Hold' : 'Not Ready'} — resolve outstanding readiness issues before submitting a bill run`);
    }

    const cycleInfo = await this.billingCycleService.getReadingPeriodForProperty(propertyId);
    if (!cycleInfo) throw new BadRequestException('No billing cycle configured for this property');
    if (!cycleInfo.closed) throw new BadRequestException('The billing cycle has not closed yet');

    // Row lock inside the transaction — the real duplicate-prevention guard. A plain pre-check
    // without this would let two concurrent requests both see "no active run" and both insert.
    const existingActive = await manager
      .createQueryBuilder(BillRun, 'br')
      .setLock('pessimistic_write')
      .where('br.property_id = :propertyId', { propertyId })
      .andWhere('br.cycle_version_id = :versionId', { versionId: cycleInfo.versionId })
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

    const entity = manager.create(BillRun, {
      batchId,
      propertyId,
      cycleMasterId: cycleInfo.masterId,
      cycleVersionId: cycleInfo.versionId,
      cyclePeriodStart: cycleInfo.periodStart,
      cyclePeriodEnd: cycleInfo.periodEnd,
      billIssueDate: addDays(cycleInfo.periodEnd, cycleInfo.billGenerationDays + cycleInfo.billIssueDays),
      billDueDate: addDays(cycleInfo.periodEnd, cycleInfo.billGenerationDays + cycleInfo.billIssueDays + cycleInfo.billDueDays),
      status: BillRunStatus.PENDING_APPROVAL,
      billableUnits: readiness.billableUnits,
      unitsMissingTariff: readiness.unitsMissingTariff,
      unitsMissingMeterMapping: readiness.unitsMissingMeterMapping,
      unitsMissingReading: readiness.unitsMissingReading,
      criticalAnomalies: readiness.criticalAnomalies,
      highAnomalies: readiness.highAnomalies,
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

  async getBatchSummary(batchId: number) {
    const batch = await this.billRunBatches.findOne({ where: { id: batchId }, relations: ['submittedBy'] });
    if (!batch) throw new NotFoundException('Bill run batch not found');
    const members = await this.billRuns.find({ where: { batchId }, relations: RESPONSE_RELATIONS });
    return { batch, members };
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

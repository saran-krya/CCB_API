import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { assertNotSelfReview, nextMajorVersion } from '../../common/utils/versioning.util';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { LovService } from '../lov/lov.service';
import { WorkflowType } from '../workflow/dto/workflow.dto';
import { WorkflowOrchestrationService } from '../workflow/workflow-orchestration.service';
import {
  BillingCycleQueryDto,
  CreateBillingCycleDto,
  DeprecateBillingCycleDto,
  NewVersionBillingCycleDto,
  RejectBillingCycleDto,
} from './dto/billing-cycle.dto';
import { BillingCycleMaster } from './entities/billing-cycle-master.entity';
import { BillingCycleVersion, BillingCycleStatus } from './entities/billing-cycle-version.entity';
import {
  BILLING_CYCLE_AUDIT_MODULE_NAME,
  BILLING_CYCLE_CHANGE_REASON_LOV_CATEGORY,
  BILLING_CYCLE_DEPRECATION_REASON_LOV_CATEGORY,
  BillingCycleAuditAction,
  NEW_VERSION_SOURCE_STATUSES,
} from './billing-cycle.constants';

const VERSION_RESPONSE_RELATIONS = ['master', 'master.community', 'master.property', 'submittedBy', 'approvedBy', 'parentVersion'];

@Injectable()
export class BillingCycleService {
  constructor(
    @InjectRepository(BillingCycleMaster)
    private readonly masters: Repository<BillingCycleMaster>,
    @InjectRepository(BillingCycleVersion)
    private readonly versions: Repository<BillingCycleVersion>,
    @InjectRepository(Community)
    private readonly communities: Repository<Community>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly lovService: LovService,
    private readonly workflowOrchestration: WorkflowOrchestrationService,
  ) {
    // Registers this service's own approve() as the AUTO_APPROVE handler for BILLING_CYCLE
    // workflows — see WorkflowOrchestrationService.registerAutoApproveHandler's own doc comment for
    // why this direction (domain -> workflow) replaced an earlier forwardRef()-based module import.
    this.workflowOrchestration.registerAutoApproveHandler(WorkflowType.BILLING_CYCLE, (id) => this.approve(id, undefined, true).then(() => undefined));
  }

  async getFilterMetadata() {
    const [communitiesRaw, propertiesRaw, frequencies] = await Promise.all([
      this.communities.find({ select: ['id', 'name'], order: { name: 'ASC' } }),
      this.dataSource.query<Array<{ id: number; name: string; communityId: number }>>(
        'SELECT id, property_name AS name, community_id AS communityId FROM properties WHERE deleted_at IS NULL ORDER BY property_name ASC',
      ),
      this.lovService.findByCategory('BILLING_FREQUENCY'),
    ]);

    return {
      communities: communitiesRaw.map((c) => ({ id: c.id, name: c.name })),
      properties: propertiesRaw,
      frequencies: frequencies.map((f) => ({ code: f.code, label: f.label })),
      statuses: [
        { value: BillingCycleStatus.ACTIVE, label: 'Active' },
        { value: BillingCycleStatus.INACTIVE, label: 'Inactive' },
        { value: BillingCycleStatus.PENDING, label: 'Pending Approval' },
        { value: BillingCycleStatus.REJECTED, label: 'Rejected' },
        { value: BillingCycleStatus.DEPRECATED, label: 'Deprecated' },
      ],
      readingDays: Array.from({ length: 31 }, (_, i) => i + 1),
    };
  }

  async getStats() {
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        COUNT(DISTINCT m.community_id)                                              AS totalCommunities,
        COUNT(DISTINCT m.property_id)                                               AS totalProperties,
        SUM(CASE WHEN v.status = 'active'     THEN 1 ELSE 0 END)                   AS activeCycles,
        SUM(CASE WHEN v.status = 'inactive'   THEN 1 ELSE 0 END)                   AS inactiveCycles,
        SUM(CASE WHEN v.status = 'pending'    THEN 1 ELSE 0 END)                   AS pendingCycles,
        SUM(CASE WHEN v.status = 'deprecated' THEN 1 ELSE 0 END)                   AS deprecatedCycles,
        SUM(CASE WHEN v.status != 'deprecated' THEN 1 ELSE 0 END)                  AS totalCycles
      FROM billing_cycle_versions v
      JOIN billing_cycle_masters m ON m.id = v.master_id
      WHERE v.deleted_at IS NULL AND m.deleted_at IS NULL
    `);

    const billsDueThisWeek = await this.countBillsDueThisWeek();
    const row = rows[0] ?? {};

    return {
      totalCommunities: Number(row.totalCommunities ?? 0),
      totalProperties: Number(row.totalProperties ?? 0),
      activeCycles: Number(row.activeCycles ?? 0),
      inactiveCycles: Number(row.inactiveCycles ?? 0),
      pendingCycles: Number(row.pendingCycles ?? 0),
      deprecatedCycles: Number(row.deprecatedCycles ?? 0),
      totalCycles: Number(row.totalCycles ?? 0),
      billsDueThisWeek,
    };
  }

  private async countBillsDueThisWeek(): Promise<number> {
    const cycles = await this.versions.find({
      select: ['readingStartDay', 'readingEndDay', 'billGenerationDays', 'billIssueDays', 'billDueDays'],
      where: { status: BillingCycleStatus.ACTIVE },
    });
    const now = new Date();
    const weekStart = now;
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let count = 0;
    for (const cycle of cycles) {
      const dates = this.computeBillCycleDates(cycle);
      if (dates && dates.dueDate >= weekStart && dates.dueDate <= weekEnd) count++;
    }
    return count;
  }

  /** Resolves the full reading period (start + end) for a MONTHLY cycle, anchored on the period's
   *  START falling in the current calendar month. readingStartDay/readingEndDay are day-of-month
   *  integers with no stored year/month — a monthly cycle always spans exactly one calendar month
   *  from start to end, so the end date lands in the month AFTER the start whenever
   *  readingEndDay <= readingStartDay (covers both "same day, e.g. 1 -> 1" — a full month, like
   *  01 Sep -> 01 Oct — and "wraps past month-end, e.g. 11 -> 10" — a sub-month window, like
   *  11 May -> 10 Jun); otherwise both days fall in the same month (e.g. 5 -> 20 within one month).
   *  new Date(year, month, day) itself correctly rolls year/month boundaries and different month
   *  lengths (e.g. month index 12 becomes January of the next year), so no manual clamping is
   *  needed beyond choosing the right month offset. This is the SINGLE source of "reading end" —
   *  every downstream date (generation/issue/due) must offset from THIS end date, not recompute
   *  its own, or they silently drift apart the way billIssueDate/billDueDate previously did.
   */
  private currentReadingPeriod(readingStartDay: number, readingEndDay: number): { start: Date; end: Date } {
    return this.readingPeriodAnchoredTo(readingStartDay, readingEndDay, new Date());
  }

  // Same day-of-month math as currentReadingPeriod, anchored to an explicit reference date instead
  // of always `new Date()` — needed for a DEPRECATED version, whose readingStartDay/readingEndDay
  // rule must be evaluated against the MONTH IT WAS ACTUALLY LIVE IN (its own effectiveFrom), never
  // today's month. Calling currentReadingPeriod directly for a deprecated version would silently
  // compute THIS month's window under that version's day-rule — a wrong, confusing result that has
  // nothing to do with the real historical period the version covered.
  private readingPeriodAnchoredTo(readingStartDay: number, readingEndDay: number, anchor: Date): { start: Date; end: Date } {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), readingStartDay);
    const endMonthOffset = readingEndDay <= readingStartDay ? 1 : 0;
    const end = new Date(start.getFullYear(), start.getMonth() + endMonthOffset, readingEndDay);
    return { start, end };
  }

  private addDays(d: Date, days: number): Date {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
  }

  /** Business rule chain, all offsetting from the SAME resolved reading-end date:
   *  Bill Generation = Reading End + billGenerationDays
   *  Bill Issue      = Reading End + billIssueDays
   *  Payment Due     = Bill Issue  + billDueDays
   *  (Bill Generation and Bill Issue are independent offsets from Reading End, not chained off
   *  each other — matches the Billing Cycle configuration screen's own field descriptions.) */
  private computeBillCycleDates(
    cycle: Pick<BillingCycleVersion, 'readingStartDay' | 'readingEndDay' | 'billGenerationDays' | 'billIssueDays' | 'billDueDays'>,
  ): { periodStart: Date; periodEnd: Date; generationDate: Date; issueDate: Date; dueDate: Date } | null {
    if (!cycle.readingStartDay || !cycle.readingEndDay) return null;
    const { start: periodStart, end: periodEnd } = this.currentReadingPeriod(cycle.readingStartDay, cycle.readingEndDay);
    const generationDate = this.addDays(periodEnd, cycle.billGenerationDays ?? 0);
    const issueDate = this.addDays(periodEnd, cycle.billIssueDays ?? 0);
    const dueDate = this.addDays(issueDate, cycle.billDueDays ?? 0);
    return { periodStart, periodEnd, generationDate, issueDate, dueDate };
  }

  private formatDate(d: Date | null | undefined): string | null {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatBillCycleId(id: number): string {
    return `BCY-${String(id).padStart(3, '0')}`;
  }

  private mapToResponse(v: BillingCycleVersion) {
    const name = (user?: { firstName: string; lastName: string } | null) =>
      user ? `${user.firstName} ${user.lastName}`.trim() : null;
    const master = v.master;
    const dates = this.computeBillCycleDates(v);

    return {
      id: v.id,
      billCycleId: this.formatBillCycleId(v.id),
      masterId: master?.id ?? null,
      communityId: master?.communityId ?? null,
      communityName: (master?.community as any)?.name ?? '',
      propertyId: master?.propertyId ?? null,
      propertyName: (master?.property as any)?.name ?? '',
      propertyCode: (master?.property as any)?.code ?? '',
      frequency: v.frequency,
      readingStartDay: v.readingStartDay,
      readingEndDay: v.readingEndDay,
      billGenerationDays: v.billGenerationDays,
      billIssueDays: v.billIssueDays,
      billDueDays: v.billDueDays,
      billCyclePeriodStart: this.formatDate(dates?.periodStart),
      billCyclePeriodEnd: this.formatDate(dates?.periodEnd),
      billGenerationDate: this.formatDate(dates?.generationDate),
      billIssueDate: this.formatDate(dates?.issueDate),
      billDueDate: this.formatDate(dates?.dueDate),
      status: v.status,
      version: v.version,
      parentBillingCycleId: v.parentVersion?.id ?? null,
      // Populated only when a parent exists AND is genuinely deprecated — a version whose parent is
      // still active/inactive (e.g. this version itself was rejected before ever displacing it) has
      // nothing to show here, per the "don't show an empty/not-yet-true section" rule. Uses the
      // SAME master as the current version (one master per property — every version, parent or
      // child, shares it) rather than re-loading parentVersion.master, which findOne()'s own
      // relations array doesn't fetch. businessCode is therefore identical to the current version's
      // own businessCode below, by construction, not coincidence.
      previousVersion: v.parentVersion && v.parentVersion.status === BillingCycleStatus.DEPRECATED
        ? {
            id: v.parentVersion.id,
            billCycleId: this.formatBillCycleId(v.parentVersion.id),
            version: v.parentVersion.version,
            businessCode: master?.businessCode ?? null,
            readingStartDay: v.parentVersion.readingStartDay,
            readingEndDay: v.parentVersion.readingEndDay,
            status: v.parentVersion.status,
            deprecatedOn: v.parentVersion.deprecatedOn ?? null,
            deprecationReasonCode: v.parentVersion.deprecationReasonCode ?? null,
          }
        : null,
      effectiveFrom: v.effectiveFrom ?? null,
      lastChangeReason: v.lastChangeReason ?? null,
      changeReasonCode: v.changeReasonCode ?? null,
      businessCode: master?.businessCode ?? null,
      submittedBy: name(v.submittedBy),
      submittedById: v.submittedBy?.id ?? null,
      submittedOn: v.submittedOn ?? null,
      approvedBy: name(v.approvedBy),
      approvedById: v.approvedBy?.id ?? null,
      approvalDate: v.approvalDate ?? null,
      rejectionNotes: v.rejectionNotes ?? null,
      deprecationReasonCode: v.deprecationReasonCode ?? null,
      deprecationNotes: v.deprecationNotes ?? null,
      deprecatedOn: v.deprecatedOn ?? null,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  async create(dto: CreateBillingCycleDto, actorId?: number) {
    let master = await this.masters.findOne({ where: { propertyId: dto.propertyId } });
    if (master?.currentVersionId) {
      throw new ConflictException('A billing cycle already exists for this property');
    }

    const [community, property] = await Promise.all([
      this.communities.findOne({ where: { id: dto.communityId } }),
      this.properties.findOne({ where: { id: dto.propertyId } }),
    ]);
    if (!community) throw new NotFoundException('Community not found');
    if (!property) throw new NotFoundException('Property not found');

    let versionNumber = '1.0';
    if (master) {
      const lastVersion = await this.versions.findOne({ where: { masterId: master.id }, order: { id: 'DESC' } });
      if (lastVersion) versionNumber = nextMajorVersion(lastVersion.version);
    }

    const savedVersionId = await this.dataSource.transaction(async (manager) => {
      if (!master) {
        const masterEntity = manager.create(BillingCycleMaster, {
          communityId: dto.communityId,
          propertyId: dto.propertyId,
        });
        master = await manager.save(BillingCycleMaster, masterEntity);
        master.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.BILLING_CYCLE, master.id);
        master = await manager.save(BillingCycleMaster, master);
      }

      const versionEntity = manager.create(BillingCycleVersion, {
        masterId: master.id,
        frequency: dto.frequency,
        readingStartDay: dto.readingStartDay,
        readingEndDay: dto.readingEndDay,
        billGenerationDays: dto.billGenerationDays,
        billIssueDays: dto.billIssueDays,
        billDueDays: dto.billDueDays,
        status: dto.status ?? BillingCycleStatus.ACTIVE,
        version: versionNumber,
      });
      const savedVersion = await manager.save(BillingCycleVersion, versionEntity);

      master.currentVersionId = savedVersion.id;
      await manager.save(BillingCycleMaster, master);

      // create() defaults to ACTIVE (no approval needed for a brand-new property's first billing
      // cycle) — only starts a workflow instance in the less-common case where a caller explicitly
      // submits it as PENDING. A cycle created ACTIVE never touches Workflow at all, exactly as
      // before this change.
      if (savedVersion.status === BillingCycleStatus.PENDING) {
        await this.workflowOrchestration.startInstance(WorkflowType.BILLING_CYCLE, savedVersion.id, actorId, manager);
      }

      await this.recordAudit(BillingCycleAuditAction.CREATE, savedVersion.id, undefined, {
        propertyId: dto.propertyId,
        communityId: dto.communityId,
        frequency: savedVersion.frequency,
        status: savedVersion.status,
      }, actorId);

      return savedVersion.id;
    });

    return this.findOne(savedVersionId);
  }

  async findAll(query: BillingCycleQueryDto) {
    const { communityId, propertyId, property, frequency, status, readingStartDay, readingEndDay, sortBy, sortOrder, search } = query;

    const SORTABLE = new Set(['createdAt', 'updatedAt', 'status', 'frequency', 'readingStartDay', 'readingEndDay']);
    const orderCol = SORTABLE.has(sortBy ?? '') ? sortBy! : 'createdAt';

    const qb = this.versions
      .createQueryBuilder('bc')
      .leftJoinAndSelect('bc.master', 'master')
      .leftJoinAndSelect('master.community', 'community')
      .leftJoinAndSelect('master.property', 'property')
      .leftJoinAndSelect('bc.submittedBy', 'submittedBy')
      .leftJoinAndSelect('bc.approvedBy', 'approvedBy')
      .leftJoinAndSelect('bc.parentVersion', 'parentVersion')
      .orderBy(`bc.${orderCol}`, sortOrder ?? 'DESC');

    if (communityId) qb.andWhere('master.community_id = :communityId', { communityId });
    if (propertyId) qb.andWhere('master.property_id = :propertyId', { propertyId });
    if (property) qb.andWhere('property.property_name LIKE :propertyName', { propertyName: `%${property}%` });
    if (frequency) qb.andWhere('bc.frequency = :frequency', { frequency });
    if (status) qb.andWhere('bc.status = :status', { status });
    if (readingStartDay) qb.andWhere('bc.reading_start_day = :readingStartDay', { readingStartDay });
    if (readingEndDay) qb.andWhere('bc.reading_end_day = :readingEndDay', { readingEndDay });
    if (search) {
      qb.andWhere(
        '(community.name LIKE :s OR property.property_name LIKE :s OR property.property_code LIKE :s OR master.businessCode LIKE :s)',
        { s: `%${search}%` },
      );
    }

    const result = await paginate(qb, query);
    return {
      items: result.items.map((bc) => this.mapToResponse(bc)),
      pagination: result.pagination,
    };
  }

  // manager, when passed, reads through that SAME connection/transaction — needed when called from
  // inside approve()/reject()'s own transaction, since a read via the injected repository (a
  // separate connection) would see the pre-commit snapshot under REPEATABLE READ and could return
  // stale status (confirmed: return value showed "pending" immediately after a successful approve
  // that the DB and audit trail both already correctly recorded as "active").
  async findOne(id: number, manager?: EntityManager) {
    const versions = manager ? manager.getRepository(BillingCycleVersion) : this.versions;
    const bc = await versions.findOne({
      where: { id },
      relations: VERSION_RESPONSE_RELATIONS,
    });
    if (!bc) throw new NotFoundException('Billing cycle not found');
    return this.mapToResponse(bc);
  }

  async findByProperty(propertyId: number) {
    const master = await this.masters.findOne({ where: { propertyId } });
    if (!master?.currentVersionId) {
      throw new NotFoundException('Billing cycle not found for this property');
    }
    return this.findOne(master.currentVersionId);
  }

  /** Non-throwing counterpart to `findByProperty` — returns `null` rather than a 404 when no
   *  billing cycle is configured for the property, so a caller doing an eligibility check (e.g.
   *  Registration's unit-eligibility validation) can test for presence without catching an
   *  exception as control flow. Mirrors `TariffService.resolveForUnit`'s null-on-unresolved shape. */
  async resolveForProperty(propertyId: number): Promise<boolean> {
    const master = await this.masters.findOne({ where: { propertyId } });
    return !!master?.currentVersionId;
  }

  /** For Billing Readiness: is this property's current reading window closed right now (i.e. has
   *  today passed the resolved period end)? Deliberately independent of the cycle version's own
   *  approval `status` (ACTIVE/PENDING/etc.) — that's a lifecycle/approval concept, this is a
   *  calendar concept; whichever version `currentVersionId` points to is "the" cycle regardless of
   *  its status, same as `findByProperty`/`resolveForProperty` already treat it. Returns `null`
   *  when no cycle is configured at all — the caller (Billing Readiness) treats that as its own
   *  distinct "no cycle" condition, never conflated with "configured but not yet closed". */
  async getReadingPeriodForProperty(propertyId: number): Promise<{
    closed: boolean;
    periodStart: string;
    periodEnd: string;
    masterId: number;
    versionId: number;
    billGenerationDays: number;
    billIssueDays: number;
    billDueDays: number;
  } | null> {
    const master = await this.masters.findOne({ where: { propertyId } });
    if (!master?.currentVersionId) return null;

    const version = await this.versions.findOne({
      where: { id: master.currentVersionId },
      select: ['id', 'readingStartDay', 'readingEndDay', 'billGenerationDays', 'billIssueDays', 'billDueDays'],
    });
    if (!version) return null;

    const { start, end } = this.currentReadingPeriod(version.readingStartDay, version.readingEndDay);
    const periodStart = this.formatDate(start);
    const periodEnd = this.formatDate(end);
    if (!periodStart || !periodEnd) return null;

    return {
      closed: new Date() > end,
      periodStart,
      periodEnd,
      masterId: master.id,
      versionId: version.id,
      billGenerationDays: version.billGenerationDays,
      billIssueDays: version.billIssueDays,
      billDueDays: version.billDueDays,
    };
  }

  /** The version-level bill-issue/due-date CONFIGURATION only (no period/master resolution) — for a
   *  caller that already has a resolved cycleVersionId from elsewhere (e.g.
   *  BillingReadinessService.checkRecoveredReadingEligibility's own resolution) and needs this
   *  version's day-offset config without re-deriving "today's" period via
   *  getReadingPeriodForProperty, which would be wrong for an explicitly-resolved PAST period. */
  async getVersionDayConfig(versionId: number): Promise<{
    billGenerationDays: number;
    billIssueDays: number;
    billDueDays: number;
  } | null> {
    const version = await this.versions.findOne({
      where: { id: versionId },
      select: ['id', 'billGenerationDays', 'billIssueDays', 'billDueDays'],
    });
    if (!version) return null;
    return {
      billGenerationDays: version.billGenerationDays,
      billIssueDays: version.billIssueDays,
      billDueDays: version.billDueDays,
    };
  }

  /** Lists a property's DEPRECATED cycle versions with their actual historical reading period —
   *  the explicit-selection source for Historical Billing. Deliberately filters to DEPRECATED only:
   *  ACTIVE is the live/current version (out of scope — historical billing is never a backdoor to
   *  the current cycle), and INACTIVE/REJECTED never went live at all (no real reading period was
   *  ever in effect under them, so there is nothing genuine to bill against).
   *
   *  A version with no `effectiveFrom` can never have had a real reading period (the day-rule has
   *  nothing to anchor to) and is excluded — this should not occur for a genuinely DEPRECATED row in
   *  practice, but is handled explicitly rather than silently producing a wrong, today-anchored
   *  period. */
  async getHistoricalVersionsForProperty(propertyId: number): Promise<Array<{
    versionId: number;
    masterId: number;
    periodStart: string;
    periodEnd: string;
    effectiveFrom: string;
    deprecatedOn: string | null;
    ageDays: number;
  }>> {
    const master = await this.masters.findOne({ where: { propertyId } });
    if (!master) return [];

    const deprecatedVersions = await this.versions.find({
      where: { masterId: master.id, status: BillingCycleStatus.DEPRECATED },
      select: ['id', 'readingStartDay', 'readingEndDay', 'effectiveFrom', 'deprecatedOn'],
      order: { effectiveFrom: 'DESC' },
    });

    const today = new Date();
    const results: Array<{
      versionId: number;
      masterId: number;
      periodStart: string;
      periodEnd: string;
      effectiveFrom: string;
      deprecatedOn: string | null;
      ageDays: number;
    }> = [];

    for (const version of deprecatedVersions) {
      if (!version.effectiveFrom) continue;
      const anchor = new Date(`${version.effectiveFrom}T00:00:00`);
      const { start, end } = this.readingPeriodAnchoredTo(version.readingStartDay, version.readingEndDay, anchor);
      const periodStart = this.formatDate(start);
      const periodEnd = this.formatDate(end);
      if (!periodStart || !periodEnd) continue;

      const ageDays = Math.max(0, Math.round((today.getTime() - end.getTime()) / (24 * 60 * 60 * 1000)));

      results.push({
        versionId: version.id,
        masterId: master.id,
        periodStart,
        periodEnd,
        effectiveFrom: version.effectiveFrom,
        deprecatedOn: version.deprecatedOn ?? null,
        ageDays,
      });
    }

    return results;
  }

  /** Resolves WHICH billing-cycle version's reading period a specific, already-known reading date
   *  actually falls into — the reverse of getReadingPeriodForProperty/getHistoricalVersionsForProperty,
   *  both of which answer "what period does version X have" given an already-known version. This
   *  answers "which version covers date Y," for Missed Reading Recovery: a recovered reading's own
   *  date is the known fact; the version it belongs to is what must be determined, never assumed or
   *  manually picked.
   *
   *  Critical correctness point this method gets right where a naive "anchor once to effectiveFrom"
   *  approach would not: a version that stays CURRENT (master.currentVersionId still points to it)
   *  recurs a NEW reading period every month for as long as it remains current — this is implicit in
   *  getReadingPeriodForProperty always anchoring to `new Date()` (live), not a stored date. A version
   *  live for 6 months genuinely had 6 different real periods under the same version id. This method
   *  mirrors that by generating one candidate period per calendar month across each version's own
   *  live window — [effectiveFrom, deprecatedOn) for a version that was later superseded, or
   *  [effectiveFrom, today] for one that is still ACTIVE/current — and testing date-containment
   *  against every candidate, not just the version's first occurrence.
   *
   *  Only ACTIVE/DEPRECATED versions are considered — PENDING/REJECTED/INACTIVE never had
   *  currentVersionId pointed at them, so no real reading period was ever genuinely in effect under
   *  them (same reasoning TariffService.resolveForUnitsAsOf uses for its own historical status set).
   *
   *  A version's recorded `deprecatedOn` is NOT always a reliable "real end" boundary — confirmed by
   *  reading activateVersion()/autoActivateDueVersions() directly: a parent's deprecatedOn is always
   *  stamped with `new Date()` at the moment the daily activation CRON actually runs and finds a
   *  pending child whose effectiveFrom has arrived, never with the child's own effectiveFrom value.
   *  If that cron is delayed (confirmed to have happened in real data — Grand Tower A's version 16
   *  shows deprecatedOn=2026-09-28 while its real successor, version 22, had effectiveFrom=2026-09-26
   *  and was already approved+active by then), deprecatedOn can lag the TRUE transition date by
   *  however long the cron was delayed, producing a real, spurious overlap between a version and its
   *  own successor. effectiveFrom itself IS the documented, business-meaningful transition date
   *  (createBillingCycle/newVersion validate it must be a real future date — "cannot activate
   *  mid-cycle" — and it is the exact, sole condition autoActivateDueVersions checks), so a version's
   *  true effective end for date-resolution purposes is the EARLIER of its own deprecatedOn and its
   *  own child's effectiveFrom, wherever that child itself ever genuinely went live (ACTIVE or
   *  DEPRECATED — a REJECTED child, like version 21 in the same real data, never actually took over
   *  anything and must never shorten the parent's window). This reads ONLY the already-stored
   *  effectiveFrom/deprecatedOn/status columns — no database write, no correction of deprecatedOn
   *  itself; the stored historical row is left exactly as it is. */
  async resolveVersionForReadingDate(
    propertyId: number,
    readingDate: string,
  ): Promise<
    | { versionId: number; masterId: number; periodStart: string; periodEnd: string }
    | 'none'
    | 'ambiguous'
  > {
    const master = await this.masters.findOne({ where: { propertyId } });
    if (!master) return 'none';

    const candidateVersions = await this.versions.find({
      where: { masterId: master.id, status: In([BillingCycleStatus.ACTIVE, BillingCycleStatus.DEPRECATED]) },
      select: ['id', 'readingStartDay', 'readingEndDay', 'effectiveFrom', 'deprecatedOn'],
    });

    // ALL versions for this master (any status) — needed to find each candidate's real children,
    // since a child could itself be PENDING/REJECTED and must be correctly excluded (see doc comment
    // above) rather than silently absent from an already-status-filtered query. parentVersion must
    // be explicitly loaded via `relations` — unlike a plain @Column, TypeORM never populates a
    // @ManyToOne relation from a bare `select` list of scalar field names.
    const allVersionsForMaster = await this.versions.find({
      where: { masterId: master.id },
      relations: ['parentVersion'],
      select: { id: true, status: true, effectiveFrom: true, parentVersion: { id: true } },
    });
    const childrenByParentId = new Map<number, typeof allVersionsForMaster>();
    for (const v of allVersionsForMaster) {
      const parentId = v.parentVersion?.id;
      if (parentId == null) continue;
      const arr = childrenByParentId.get(parentId) ?? [];
      arr.push(v);
      childrenByParentId.set(parentId, arr);
    }
    const LIVE_CHILD_STATUSES = new Set<BillingCycleStatus>([BillingCycleStatus.ACTIVE, BillingCycleStatus.DEPRECATED]);

    const target = new Date(`${readingDate}T00:00:00`);
    const today = new Date();
    const matches: Array<{ versionId: number; periodStart: string; periodEnd: string }> = [];

    for (const version of candidateVersions) {
      if (!version.effectiveFrom) continue; // No real anchor — never genuinely live, same guard as getHistoricalVersionsForProperty.

      const windowStart = new Date(`${version.effectiveFrom}T00:00:00`);

      // The child-derived bound (Option A): among this version's own children that ever genuinely
      // went live, the EARLIEST such child's effectiveFrom is this version's true handover date —
      // that child becoming current is what actually ended this version's own reading periods,
      // regardless of when deprecatedOn was later stamped. More than one live child with DIFFERENT
      // effectiveFrom dates is a genuinely contradictory state (the data claims this version was
      // superseded twice, at two different times) — surfaced as 'ambiguous' for THIS version's
      // resolution rather than silently picking the earliest or latest.
      const liveChildren = (childrenByParentId.get(version.id) ?? []).filter(
        (c) => LIVE_CHILD_STATUSES.has(c.status) && !!c.effectiveFrom,
      );
      const distinctChildEffectiveFroms = new Set(liveChildren.map((c) => c.effectiveFrom));
      if (distinctChildEffectiveFroms.size > 1) return 'ambiguous';
      const childEffectiveFrom = liveChildren[0]?.effectiveFrom ?? null;

      // Exclusive upper bound: whichever is EARLIER of the recorded deprecatedOn and a live child's
      // own effectiveFrom (Option A) — deprecatedOn can lag the true handover (see doc comment
      // above), so it alone is not trusted when a live child's own effectiveFrom is available and
      // earlier. A still-current version (deprecatedOn null, no live child) is bounded by today — no
      // period can exist for a month that hasn't happened yet.
      const candidateBounds = [
        version.deprecatedOn ? new Date(`${version.deprecatedOn}T00:00:00`) : null,
        childEffectiveFrom ? new Date(`${childEffectiveFrom}T00:00:00`) : null,
      ].filter((d): d is Date => d !== null);
      const windowEndExclusive = candidateBounds.length > 0
        ? new Date(Math.min(...candidateBounds.map((d) => d.getTime())))
        : today;
      if (windowEndExclusive <= windowStart) continue; // Defensive — a malformed/zero-length window has no real periods.

      // One candidate period per calendar month, walked from the version's anchor month through
      // (at most) one month past windowEndExclusive — a loose outer bound only; the real guard is
      // the per-candidate check below, which verifies the COMPUTED PERIOD ITSELF (not merely "the
      // month it falls in") lies within [windowStart, windowEndExclusive). Bounding only by month
      // was the actual bug a boundary test caught here: a version deprecated exactly on the 1st of
      // a month has zero live days in that month, yet its day-rule can still mathematically produce
      // a period dated within that same month (e.g. periodStart = the 1st) — checking the month
      // alone would wrongly count it. Checking the period's own start/end against the real window
      // is what correctly excludes that case while still correctly INCLUDING a version deprecated
      // mid-month whose period genuinely completed before the deprecation date.
      let cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
      const cursorStop = new Date(windowEndExclusive.getFullYear(), windowEndExclusive.getMonth() + 1, 1);
      while (cursor.getTime() < cursorStop.getTime()) {
        const { start, end } = this.readingPeriodAnchoredTo(version.readingStartDay, version.readingEndDay, cursor);
        const periodGenuinelyLive = start.getTime() >= windowStart.getTime() && start.getTime() < windowEndExclusive.getTime();
        // The TARGET date itself must also fall strictly before windowEndExclusive — checking only
        // the period's own START (above) is not sufficient: a period can legitimately START inside
        // this version's live window yet still EXTEND past the moment a child version actually took
        // over (e.g. version 16's 25-30 Sep period starts within its own window but, once Option A
        // shortens that window to end at version 22's 26 Sep effectiveFrom, the 28th itself falls
        // after the real handover even though the period's start date does not). Without this check,
        // a version's trailing days after its own successor's effectiveFrom would still wrongly
        // match, silently defeating the whole point of the child-derived bound above.
        const targetBeforeHandover = target.getTime() < windowEndExclusive.getTime();
        if (periodGenuinelyLive && targetBeforeHandover && target.getTime() >= start.getTime() && target.getTime() <= end.getTime()) {
          const periodStart = this.formatDate(start);
          const periodEnd = this.formatDate(end);
          if (periodStart && periodEnd) matches.push({ versionId: version.id, periodStart, periodEnd });
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    }

    if (matches.length === 0) return 'none';
    // More than one match (e.g. two versions whose computed windows both happen to touch this exact
    // date — a real data overlap, not a resolution-logic choice) is surfaced explicitly, never
    // silently resolved to "the first one" or "the most recent one."
    const distinctVersionIds = new Set(matches.map((m) => m.versionId));
    if (distinctVersionIds.size > 1) return 'ambiguous';

    const { versionId, periodStart, periodEnd } = matches[0];
    return { versionId, masterId: master.id, periodStart, periodEnd };
  }

  async newVersion(id: number, dto: NewVersionBillingCycleDto, actorId?: number) {
    const source = await this.versions.findOne({
      where: { id },
      relations: ['childVersions'],
    });
    if (!source) throw new NotFoundException('Billing cycle not found');
    if (!NEW_VERSION_SOURCE_STATUSES.has(source.status)) {
      throw new BadRequestException("A new version can only be created from the property's active or inactive billing cycle");
    }

    const hasPendingChild = (source.childVersions ?? []).some((c) => c.status === BillingCycleStatus.PENDING);
    if (hasPendingChild) {
      throw new ConflictException('A new version is already pending approval for this billing cycle');
    }

    const today = new Date().toISOString().slice(0, 10);
    if (dto.effectiveFrom <= today) {
      throw new BadRequestException('Effective date must be in the future — a billing cycle cannot activate mid-cycle');
    }

    await this.assertValidLovCode(BILLING_CYCLE_CHANGE_REASON_LOV_CATEGORY, dto.reasonCode);
    this.assertNotesRequiredForOtherReason(dto.reasonCode, dto.notes);

    const saved = await this.dataSource.transaction(async (manager) => {
      const clone = manager.create(BillingCycleVersion, {
        masterId: source.masterId,
        frequency: source.frequency,
        readingStartDay: dto.readingStartDay,
        readingEndDay: dto.readingEndDay,
        billGenerationDays: source.billGenerationDays,
        billIssueDays: source.billIssueDays,
        billDueDays: source.billDueDays,
        status: BillingCycleStatus.PENDING,
        version: nextMajorVersion(source.version),
        parentVersion: { id: source.id } as BillingCycleVersion,
        effectiveFrom: dto.effectiveFrom,
        changeReasonCode: dto.reasonCode,
        lastChangeReason: dto.notes ?? null,
        submittedBy: actorId ? ({ id: actorId } as any) : null,
        submittedOn: today,
      });
      const savedClone = await manager.save(BillingCycleVersion, clone);
      await this.workflowOrchestration.startInstance(WorkflowType.BILLING_CYCLE, savedClone.id, actorId, manager);
      return savedClone;
    });

    await this.recordAudit(
      BillingCycleAuditAction.CREATE_VERSION,
      saved.id,
      { sourceId: source.id, sourceVersion: source.version },
      saved,
      actorId,
    );
    return this.findOne(saved.id);
  }

  // Wrapped in a transaction with a pessimistic lock on the initial read — without it, two
  // concurrent reviewers (e.g. one approving, one rejecting) can both read status === PENDING
  // before either writes, both pass this check, and both save — a confirmed real race (found via
  // Promise.allSettled testing both calls simultaneously): the DB ends up with whichever write
  // landed last, but BOTH calls report success, and if the version's effectiveFrom had already
  // arrived, approve()'s activateVersion() (which deprecates the parent + moves the master's
  // currentVersionId pointer) could race a concurrent reject() write. The lock forces the second
  // transaction to wait for the first to commit, then re-read and correctly see status !== PENDING.
  // `isSystemActor` — true ONLY from WorkflowSlaSchedulerService's AUTO_APPROVE path (the HTTP
  // controller never passes a 3rd argument). `approvedBy` is only ever set `if (actorId)` below —
  // with actorId undefined for a system call, a system-approved version correctly has NO human
  // approver on record, never a faked one (requirement: "Do not fake a human approver").
  async approve(id: number, actorId?: number, isSystemActor = false) {
    return this.dataSource.transaction(async (manager) => {
      // Workflow check joins this SAME transaction/lock (not a separate one) — consistent with every
      // other domain's own pessimistic-write lock already in place here; assertCanAct itself takes
      // its own row lock on the WorkflowInstance, acquired before the BillingCycleVersion lock below,
      // in the same order every other domain acquires it.
      const workflowContext = await this.workflowOrchestration.assertCanAct(WorkflowType.BILLING_CYCLE, id, actorId, manager, isSystemActor);

      const cycle = await manager
        .createQueryBuilder(BillingCycleVersion, 'bcv')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('bcv.submittedBy', 'submittedBy')
        .leftJoinAndSelect('bcv.parentVersion', 'parentVersion')
        .where('bcv.id = :id', { id })
        .getOne();
      if (!cycle) throw new NotFoundException('Billing cycle not found');
      if (cycle.status !== BillingCycleStatus.PENDING) {
        throw new BadRequestException('Only a pending billing cycle version can be approved');
      }
      assertNotSelfReview(cycle.submittedBy?.id, actorId, 'approved');

      const oldValue = { ...cycle };

      // approvedBy/approvalDate are only set once the FINAL workflow level has approved — an
      // intermediate level's approval must not make this version look fully approved (the frontend's
      // "Approved by X on Y" display, and autoActivateDueVersions()'s own `approved_by_id IS NOT
      // NULL` scheduler condition, both key off this field). When no workflow is configured,
      // isFinalLevel is always true, so this runs exactly as before.
      if (workflowContext.isFinalLevel) {
        if (actorId) cycle.approvedBy = { id: actorId } as any;
        cycle.approvalDate = new Date().toISOString().slice(0, 10);

        const today = new Date().toISOString().slice(0, 10);
        if (cycle.effectiveFrom && cycle.effectiveFrom <= today) {
          await this.activateVersion(cycle, actorId, manager);
        } else {
          await manager.save(BillingCycleVersion, cycle);
        }
      }

      await this.workflowOrchestration.recordApproval(
        workflowContext, actorId,
        isSystemActor ? 'Auto-approved by system — SLA breach, no human action taken on this level.' : undefined,
        manager,
      );
      await this.recordAudit(BillingCycleAuditAction.APPROVE, id, oldValue, cycle, actorId, manager);
      return this.findOne(id, manager);
    });
  }

  // See approve()'s own comment on why this needs a transaction + pessimistic lock.
  async reject(id: number, dto: RejectBillingCycleDto, actorId?: number) {
    return this.dataSource.transaction(async (manager) => {
      const workflowContext = await this.workflowOrchestration.assertCanAct(WorkflowType.BILLING_CYCLE, id, actorId, manager);

      const cycle = await manager
        .createQueryBuilder(BillingCycleVersion, 'bcv')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('bcv.submittedBy', 'submittedBy')
        .where('bcv.id = :id', { id })
        .getOne();
      if (!cycle) throw new NotFoundException('Billing cycle not found');
      if (cycle.status !== BillingCycleStatus.PENDING) {
        throw new BadRequestException('Only a pending billing cycle version can be rejected');
      }
      assertNotSelfReview(cycle.submittedBy?.id, actorId, 'rejected');

      const oldValue = { ...cycle };
      cycle.status = BillingCycleStatus.REJECTED;
      cycle.rejectionNotes = dto.notes;
      if (actorId) cycle.approvedBy = { id: actorId } as any;
      cycle.approvalDate = new Date().toISOString().slice(0, 10);
      const saved = await manager.save(BillingCycleVersion, cycle);
      // A rejection at ANY level ends the whole workflow — same principle as Tariff/BillRun. The
      // version's own existing resubmit() path (REJECTED -> PENDING on the same row) is what starts
      // a fresh workflow instance from Level 1 again; see resubmit()'s own comment below.
      await this.workflowOrchestration.recordRejection(workflowContext, actorId, dto.notes, manager);
      await this.recordAudit(BillingCycleAuditAction.REJECT, id, oldValue, saved, actorId, manager);
      return this.findOne(id, manager);
    });
  }

  async resubmit(id: number, actorId?: number) {
    const cycle = await this.versions.findOne({ where: { id } });
    if (!cycle) throw new NotFoundException('Billing cycle not found');
    if (cycle.status !== BillingCycleStatus.REJECTED) {
      throw new BadRequestException('Only a rejected billing cycle version can be resubmitted');
    }

    return this.dataSource.transaction(async (manager) => {
      const oldValue = { ...cycle };
      cycle.status = BillingCycleStatus.PENDING;
      cycle.rejectionNotes = null;
      cycle.approvedBy = null;
      cycle.approvalDate = null;
      if (actorId) cycle.submittedBy = { id: actorId } as any;
      cycle.submittedOn = new Date().toISOString().slice(0, 10);
      const saved = await manager.save(BillingCycleVersion, cycle);
      // Resubmitting reuses the SAME row (unlike Bill Run's resubmit, which inserts a new one) — the
      // prior instance for this businessObjectId is already REJECTED/terminal, so startInstance
      // begins a brand-new instance at Level 1 rather than resuming the old one. Approval must run
      // the full configured sequence again from the start, exactly like a fresh submission.
      await this.workflowOrchestration.startInstance(WorkflowType.BILLING_CYCLE, saved.id, actorId, manager);
      await this.recordAudit(BillingCycleAuditAction.RESUBMIT, id, oldValue, saved, actorId, manager);
      return this.findOne(id, manager);
    });
  }

  async deprecate(id: number, dto: DeprecateBillingCycleDto, actorId?: number) {
    const cycle = await this.versions.findOne({ where: { id }, relations: ['childVersions'] });
    if (!cycle) throw new NotFoundException('Billing cycle not found');
    if (cycle.status === BillingCycleStatus.DEPRECATED) {
      throw new BadRequestException('This billing cycle is already deprecated');
    }
    if (cycle.status === BillingCycleStatus.PENDING) {
      throw new BadRequestException('A version awaiting Finance approval is read-only — reject it instead of deprecating it');
    }
    if (this.hasScheduledDeprecation(cycle)) {
      throw new ConflictException(`A deprecation is already scheduled for this billing cycle, effective ${cycle.deprecatedOn}`);
    }

    if (cycle.status === BillingCycleStatus.ACTIVE) {
      const hasReplacement = (cycle.childVersions ?? []).some(
        (c) => c.status !== BillingCycleStatus.DEPRECATED && c.status !== BillingCycleStatus.REJECTED,
      );
      if (!hasReplacement && !dto.acknowledged) {
        throw new BadRequestException(
          'No replacement billing cycle exists for this property — deprecating leaves it without an active billing cycle. Set acknowledged to confirm.',
        );
      }
    }

    if (!dto.acknowledged) {
      throw new BadRequestException('You must acknowledge that billing will stop for this property before deprecating.');
    }

    const today = new Date().toISOString().slice(0, 10);
    const effectiveDate = dto.effectiveDeprecationDate ?? today;
    if (effectiveDate < today) {
      throw new BadRequestException('Effective deprecation date cannot be in the past.');
    }

    await this.assertValidLovCode(BILLING_CYCLE_DEPRECATION_REASON_LOV_CATEGORY, dto.reasonCode);
    this.assertNotesRequiredForOtherReason(dto.reasonCode, dto.notes);

    const oldValue = { ...cycle };

    if (effectiveDate <= today) {
      const saved = await this.applyDeprecation(cycle, dto.reasonCode, dto.notes ?? null, effectiveDate);
      await this.recordAudit(BillingCycleAuditAction.DEPRECATE, id, oldValue, saved, actorId);
    } else {
      cycle.deprecationReasonCode = dto.reasonCode;
      cycle.deprecationNotes = dto.notes ?? null;
      cycle.deprecatedOn = effectiveDate;
      const saved = await this.versions.save(cycle);
      await this.recordAudit(BillingCycleAuditAction.SCHEDULE_DEPRECATION, id, oldValue, saved, actorId);
    }

    return this.findOne(id);
  }

  private async applyDeprecation(
    cycle: BillingCycleVersion,
    reasonCode: string,
    notes: string | null,
    effectiveDate: string,
    manager?: EntityManager,
  ): Promise<BillingCycleVersion> {
    const versions = manager ? manager.getRepository(BillingCycleVersion) : this.versions;
    const masters = manager ? manager.getRepository(BillingCycleMaster) : this.masters;

    cycle.status = BillingCycleStatus.DEPRECATED;
    cycle.deprecationReasonCode = reasonCode;
    cycle.deprecationNotes = notes;
    cycle.deprecatedOn = effectiveDate;
    const saved = await versions.save(cycle);

    const master = await masters.findOne({ where: { id: cycle.masterId } });
    if (master && master.currentVersionId === cycle.id) {
      master.currentVersionId = null;
      await masters.save(master);
    }

    return saved;
  }

  private hasScheduledDeprecation(cycle: BillingCycleVersion): boolean {
    const today = new Date().toISOString().slice(0, 10);
    return !!cycle.deprecatedOn && cycle.deprecatedOn > today && cycle.status !== BillingCycleStatus.DEPRECATED;
  }

  async autoDeprecateDueCycles(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const due = await this.versions
      .createQueryBuilder('bc')
      .where('bc.status != :deprecated', { deprecated: BillingCycleStatus.DEPRECATED })
      .andWhere('bc.deprecated_on IS NOT NULL')
      .andWhere('bc.deprecated_on <= :today', { today })
      .getMany();

    for (const cycle of due) {
      const oldValue = { ...cycle };
      const saved = await this.applyDeprecation(
        cycle,
        cycle.deprecationReasonCode ?? 'other',
        cycle.deprecationNotes ?? null,
        cycle.deprecatedOn!,
      );
      await this.recordAudit(BillingCycleAuditAction.AUTO_DEPRECATE, cycle.id, oldValue, saved, undefined);
    }

    return due.length;
  }

  // manager, when passed (from approve()'s own transaction+lock), keeps these writes inside that
  // SAME transaction/connection — using the injected repositories here instead would run them on a
  // separate connection, outside the lock's protection, defeating the point of taking it.
  private async activateVersion(
    cycle: BillingCycleVersion,
    actorId?: number,
    manager?: EntityManager,
  ): Promise<BillingCycleVersion> {
    const versions = manager ? manager.getRepository(BillingCycleVersion) : this.versions;
    const masters = manager ? manager.getRepository(BillingCycleMaster) : this.masters;

    cycle.status = BillingCycleStatus.ACTIVE;
    const saved = await versions.save(cycle);

    const master = await masters.findOne({ where: { id: cycle.masterId } });
    if (master) {
      master.currentVersionId = cycle.id;
      await masters.save(master);
    }

    const parentId = cycle.parentVersion?.id;
    if (parentId) {
      const parent = await versions.findOne({ where: { id: parentId } });
      if (parent && parent.status !== BillingCycleStatus.DEPRECATED) {
        const parentOldValue = { ...parent };
        const savedParent = await this.applyDeprecation(
          parent,
          'replaced-by-new-version',
          null,
          new Date().toISOString().slice(0, 10),
          manager,
        );
        await this.recordAudit(
          actorId ? BillingCycleAuditAction.DEPRECATE : BillingCycleAuditAction.AUTO_DEPRECATE,
          parent.id,
          parentOldValue,
          savedParent,
          actorId,
          manager,
        );
      }
    }

    return saved;
  }

  async autoActivateDueVersions(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const due = await this.versions
      .createQueryBuilder('bc')
      .leftJoinAndSelect('bc.parentVersion', 'parentVersion')
      .where('bc.status = :pending', { pending: BillingCycleStatus.PENDING })
      .andWhere('bc.approved_by_id IS NOT NULL')
      .andWhere('bc.effective_from IS NOT NULL')
      .andWhere('bc.effective_from <= :today', { today })
      .getMany();

    for (const cycle of due) {
      const oldValue = { ...cycle };
      const saved = await this.activateVersion(cycle);
      await this.recordAudit(BillingCycleAuditAction.AUTO_ACTIVATE, cycle.id, oldValue, saved, undefined);
    }

    return due.length;
  }

  private async assertValidLovCode(category: string, code: string): Promise<void> {
    const values = await this.lovService.findByCategory(category);
    if (!values.some((v) => v.code === code)) {
      throw new BadRequestException(`"${code}" is not a valid value for ${category}`);
    }
  }

  private assertNotesRequiredForOtherReason(reasonCode: string, notes: string | null | undefined): void {
    if (reasonCode === 'other' && !notes?.trim()) {
      throw new BadRequestException('Notes are required when selecting "Other" as the reason.');
    }
  }

  private async recordAudit(
    action: BillingCycleAuditAction,
    entityId: number,
    oldValue: unknown,
    newValue: unknown,
    actorId?: number,
    manager?: EntityManager,
  ): Promise<void> {
    await this.auditService.record(
      {
        moduleName: BILLING_CYCLE_AUDIT_MODULE_NAME,
        entityId,
        action,
        oldValue,
        newValue,
        performedBy: actorId,
      },
      manager,
    );
  }
}

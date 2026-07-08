import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { ROLES } from '../../common/constants/global';
import { paginate } from '../../common/utils/pagination.util';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { LovService } from '../lov/lov.service';
import { AttributeService } from '../attribute/attribute.service';
import {
  BillingCycleQueryDto,
  CreateBillingCycleDto,
  DeprecateBillingCycleDto,
  NewVersionBillingCycleDto,
  RejectBillingCycleDto,
  UpdateBillingCycleDto,
} from './dto/billing-cycle.dto';
import { BillingCycle, BillingCycleStatus } from './entities/billing-cycle.entity';
import {
  BILLING_CYCLE_AUDIT_MODULE_NAME,
  BILLING_CYCLE_CHANGE_REASON_LOV_CATEGORY,
  BILLING_CYCLE_CODE_PAD_WIDTH,
  BILLING_CYCLE_CODE_PREFIX,
  BILLING_CYCLE_DEPRECATION_REASON_LOV_CATEGORY,
  BillingCycleAuditAction,
  EDITABLE_BILLING_CYCLE_STATUSES,
  LOCKED_BILLING_CYCLE_FIELDS,
  NEW_VERSION_SOURCE_STATUSES,
  REQUIRE_CHANGE_REASON_ON_EDIT_ATTRIBUTE_KEY,
} from './billing-cycle.constants';

@Injectable()
export class BillingCycleService {
  constructor(
    @InjectRepository(BillingCycle)
    private readonly billingCycles: Repository<BillingCycle>,
    @InjectRepository(Community)
    private readonly communities: Repository<Community>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly lovService: LovService,
    private readonly attributeService: AttributeService,
  ) {}

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
        COUNT(DISTINCT bc.community_id)                                              AS totalCommunities,
        COUNT(DISTINCT bc.property_id)                                               AS totalProperties,
        SUM(CASE WHEN bc.status = 'active'     THEN 1 ELSE 0 END)                   AS activeCycles,
        SUM(CASE WHEN bc.status = 'inactive'   THEN 1 ELSE 0 END)                   AS inactiveCycles,
        SUM(CASE WHEN bc.status = 'pending'    THEN 1 ELSE 0 END)                   AS pendingCycles,
        SUM(CASE WHEN bc.status = 'deprecated' THEN 1 ELSE 0 END)                   AS deprecatedCycles,
        SUM(CASE WHEN bc.status != 'deprecated' THEN 1 ELSE 0 END)                  AS totalCycles
      FROM billing_cycles bc
      WHERE bc.deleted_at IS NULL
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
    const cycles = await this.billingCycles.find({
      select: ['readingEndDay', 'billIssueDays', 'billDueDays'],
      where: { status: BillingCycleStatus.ACTIVE },
    });
    const now = new Date();
    const weekStart = now;
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let count = 0;
    for (const cycle of cycles) {
      const dueDate = this.computeBillDueDateObj(cycle);
      if (dueDate && dueDate >= weekStart && dueDate <= weekEnd) count++;
    }
    return count;
  }

  private computeBillDueDateObj(cycle: Pick<BillingCycle, 'readingEndDay' | 'billIssueDays' | 'billDueDays'>): Date | null {
    if (!cycle.readingEndDay) return null;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const readingEndDate = new Date(year, month, cycle.readingEndDay);
    const billIssueDate = new Date(readingEndDate);
    billIssueDate.setDate(billIssueDate.getDate() + (cycle.billIssueDays ?? 0));
    const billDueDate = new Date(billIssueDate);
    billDueDate.setDate(billDueDate.getDate() + (cycle.billDueDays ?? 0));
    return billDueDate;
  }

  private formatBillDueDate(cycle: Pick<BillingCycle, 'readingEndDay' | 'billIssueDays' | 'billDueDays'>): string | null {
    const d = this.computeBillDueDateObj(cycle);
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatBillCycleId(id: number): string {
    return `BCY-${String(id).padStart(3, '0')}`;
  }

  private mapToResponse(bc: BillingCycle) {
    const name = (user?: { firstName: string; lastName: string } | null) =>
      user ? `${user.firstName} ${user.lastName}`.trim() : null;

    return {
      id: bc.id,
      billCycleId: this.formatBillCycleId(bc.id),
      communityId: bc.communityId,
      communityName: (bc.community as any)?.name ?? '',
      propertyId: bc.propertyId,
      propertyName: (bc.property as any)?.name ?? '',
      propertyCode: (bc.property as any)?.code ?? '',
      frequency: bc.frequency,
      readingStartDay: bc.readingStartDay,
      readingEndDay: bc.readingEndDay,
      billGenerationDays: bc.billGenerationDays,
      billIssueDays: bc.billIssueDays,
      billDueDays: bc.billDueDays,
      billDueDate: this.formatBillDueDate(bc),
      status: bc.status,
      version: bc.version,
      parentBillingCycleId: bc.parentBillingCycle?.id ?? null,
      effectiveFrom: bc.effectiveFrom ?? null,
      lastChangeReason: bc.lastChangeReason ?? null,
      changeReasonCode: bc.changeReasonCode ?? null,
      businessCode: bc.businessCode ?? null,
      submittedBy: name(bc.submittedBy),
      submittedById: bc.submittedBy?.id ?? null,
      submittedOn: bc.submittedOn ?? null,
      approvedBy: name(bc.approvedBy),
      approvedById: bc.approvedBy?.id ?? null,
      approvalDate: bc.approvalDate ?? null,
      rejectionNotes: bc.rejectionNotes ?? null,
      deprecationReasonCode: bc.deprecationReasonCode ?? null,
      deprecationNotes: bc.deprecationNotes ?? null,
      deprecatedOn: bc.deprecatedOn ?? null,
      createdAt: bc.createdAt,
      updatedAt: bc.updatedAt,
    };
  }

  async create(dto: CreateBillingCycleDto, actorId?: number) {
    // Excludes DEPRECATED — a fully retired cycle shouldn't permanently
    // block a property from ever getting a fresh one configured again.
    // Mirrors TariffService.checkConflict(), which likewise only treats
    // ACTIVE/PENDING/REQUEST_FOR_CORRECTION tariffs as "live" conflicts.
    const existing = await this.billingCycles.findOne({
      where: { propertyId: dto.propertyId, status: Not(BillingCycleStatus.DEPRECATED) },
    });
    if (existing) {
      throw new ConflictException(
        'A billing cycle already exists for this property',
      );
    }

    const [community, property] = await Promise.all([
      this.communities.findOne({ where: { id: dto.communityId } }),
      this.properties.findOne({ where: { id: dto.propertyId } }),
    ]);
    if (!community) throw new NotFoundException('Community not found');
    if (!property) throw new NotFoundException('Property not found');

    const saved = await this.dataSource.transaction(async (manager) => {
      const entity = manager.create(BillingCycle, {
        ...dto,
        status: dto.status ?? BillingCycleStatus.INACTIVE,
        version: '1.0',
      });
      const s = await manager.save(BillingCycle, entity);
      s.businessCode = `${BILLING_CYCLE_CODE_PREFIX}${String(s.id).padStart(BILLING_CYCLE_CODE_PAD_WIDTH, '0')}`;
      await manager.save(BillingCycle, s);

      await this.recordAudit(BillingCycleAuditAction.CREATE, s.id, undefined, {
        propertyId: s.propertyId,
        communityId: s.communityId,
        frequency: s.frequency,
        status: s.status,
      }, actorId);

      return s;
    });

    return this.findOne(saved.id);
  }

  async findAll(query: BillingCycleQueryDto) {
    const { communityId, propertyId, property, frequency, status, readingStartDay, readingEndDay, sortBy, sortOrder, search } = query;

    const SORTABLE = new Set(['createdAt', 'updatedAt', 'status', 'frequency', 'readingStartDay', 'readingEndDay']);
    const orderCol = SORTABLE.has(sortBy ?? '') ? sortBy! : 'createdAt';

    const qb = this.billingCycles
      .createQueryBuilder('bc')
      .leftJoinAndSelect('bc.community', 'community')
      .leftJoinAndSelect('bc.property', 'property')
      .leftJoinAndSelect('bc.submittedBy', 'submittedBy')
      .leftJoinAndSelect('bc.approvedBy', 'approvedBy')
      .leftJoinAndSelect('bc.parentBillingCycle', 'parentBillingCycle')
      .orderBy(`bc.${orderCol}`, sortOrder ?? 'DESC');

    if (communityId) qb.andWhere('bc.community_id = :communityId', { communityId });
    if (propertyId) qb.andWhere('bc.property_id = :propertyId', { propertyId });
    if (property) qb.andWhere('property.property_name LIKE :propertyName', { propertyName: `%${property}%` });
    if (frequency) qb.andWhere('bc.frequency = :frequency', { frequency });
    if (status) qb.andWhere('bc.status = :status', { status });
    if (readingStartDay) qb.andWhere('bc.reading_start_day = :readingStartDay', { readingStartDay });
    if (readingEndDay) qb.andWhere('bc.reading_end_day = :readingEndDay', { readingEndDay });
    if (search) {
      qb.andWhere(
        '(community.name LIKE :s OR property.property_name LIKE :s OR property.property_code LIKE :s OR bc.businessCode LIKE :s)',
        { s: `%${search}%` },
      );
    }

    const result = await paginate(qb, query);
    return {
      items: result.items.map((bc) => this.mapToResponse(bc)),
      pagination: result.pagination,
    };
  }

  async findOne(id: number) {
    const bc = await this.billingCycles.findOne({
      where: { id },
      relations: ['community', 'property', 'submittedBy', 'approvedBy', 'parentBillingCycle'],
    });
    if (!bc) throw new NotFoundException('Billing cycle not found');
    return this.mapToResponse(bc);
  }

  // Resolves the single currently-governing (non-deprecated) row for a
  // property — there can briefly be both an ACTIVE row and a newer PENDING
  // one awaiting a future effectiveFrom; ACTIVE always wins as "current".
  async findByProperty(propertyId: number) {
    const active = await this.billingCycles.find({
      where: { propertyId, status: BillingCycleStatus.ACTIVE },
      relations: ['community', 'property', 'submittedBy', 'approvedBy', 'parentBillingCycle'],
    });
    if (active.length) return this.mapToResponse(active[0]);

    const fallback = await this.billingCycles.find({
      where: { propertyId },
      relations: ['community', 'property', 'submittedBy', 'approvedBy', 'parentBillingCycle'],
      order: { createdAt: 'DESC' },
    });
    const governing = fallback.find((r) => r.status !== BillingCycleStatus.DEPRECATED) ?? fallback[0];
    if (!governing) throw new NotFoundException('Billing cycle not found for this property');
    return this.mapToResponse(governing);
  }

  async update(id: number, dto: UpdateBillingCycleDto, actorId?: number) {
    const bc = await this.billingCycles.findOne({
      where: { id },
      relations: ['community', 'property'],
    });
    if (!bc) throw new NotFoundException('Billing cycle not found');

    if (!EDITABLE_BILLING_CYCLE_STATUSES.has(bc.status)) {
      throw new BadRequestException(
        bc.status === BillingCycleStatus.PENDING
          ? 'A version awaiting Finance approval is read-only — approve, reject, or wait for a decision'
          : 'A deprecated billing cycle is read-only',
      );
    }

    this.assertNoLockedFields(dto);
    this.assertToggleOnlyStatusChange(bc, dto);

    const requireReason = await this.attributeService.isMandatory(REQUIRE_CHANGE_REASON_ON_EDIT_ATTRIBUTE_KEY);
    if (requireReason && !dto.reasonForChange?.trim() && !dto.reasonCode) {
      throw new BadRequestException('A change reason is required when editing an existing billing cycle');
    }
    if (dto.reasonCode) {
      await this.assertValidLovCode(BILLING_CYCLE_CHANGE_REASON_LOV_CATEGORY, dto.reasonCode);
      this.assertNotesRequiredForOtherReason(dto.reasonCode, dto.reasonForChange);
    }

    const oldValue = {
      frequency: bc.frequency,
      billGenerationDays: bc.billGenerationDays,
      billIssueDays: bc.billIssueDays,
      billDueDays: bc.billDueDays,
      status: bc.status,
    };

    const { reasonForChange, reasonCode, ...fields } = dto;
    Object.assign(bc, fields);
    if (reasonForChange) bc.lastChangeReason = reasonForChange;
    if (reasonCode) bc.changeReasonCode = reasonCode;

    const saved = await this.billingCycles.save(bc);

    await this.recordAudit(BillingCycleAuditAction.UPDATE, id, oldValue, { ...fields, reasonForChange, reasonCode }, actorId);

    return this.mapToResponse(saved);
  }

  // Business Rule 3/5 — the only way to change the reading window: clone the
  // property's current governing cycle into a new PENDING version awaiting
  // Finance approval, effective from a not-yet-reached date.
  async newVersion(id: number, dto: NewVersionBillingCycleDto, actorId?: number) {
    const source = await this.billingCycles.findOne({
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
      const clone = manager.create(BillingCycle, {
        communityId: source.communityId,
        propertyId: source.propertyId,
        businessCode: source.businessCode,
        frequency: source.frequency,
        readingStartDay: dto.readingStartDay,
        readingEndDay: dto.readingEndDay,
        billGenerationDays: source.billGenerationDays,
        billIssueDays: source.billIssueDays,
        billDueDays: source.billDueDays,
        status: BillingCycleStatus.PENDING,
        version: this.nextMajorVersion(source.version),
        parentBillingCycle: { id: source.id } as BillingCycle,
        effectiveFrom: dto.effectiveFrom,
        changeReasonCode: dto.reasonCode,
        lastChangeReason: dto.notes ?? null,
        submittedBy: actorId ? ({ id: actorId } as any) : null,
        submittedOn: today,
      });
      return manager.save(BillingCycle, clone);
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

  async approve(id: number, actorId?: number, actorRole?: string) {
    const cycle = await this.billingCycles.findOne({
      where: { id },
      relations: ['submittedBy', 'parentBillingCycle'],
    });
    if (!cycle) throw new NotFoundException('Billing cycle not found');
    if (cycle.status !== BillingCycleStatus.PENDING) {
      throw new BadRequestException('Only a pending billing cycle version can be approved');
    }
    this.assertOnlyFinanceMayReview(actorRole, 'approve');
    this.assertNotSelfReview(cycle, actorId, 'approved');

    const oldValue = { ...cycle };
    if (actorId) cycle.approvedBy = { id: actorId } as any;
    cycle.approvalDate = new Date().toISOString().slice(0, 10);

    const today = new Date().toISOString().slice(0, 10);
    if (cycle.effectiveFrom && cycle.effectiveFrom <= today) {
      // The effective date has already arrived — activate immediately
      // rather than leaving it stuck in PENDING until the next midnight sweep.
      await this.activateVersion(cycle, actorId);
    } else {
      await this.billingCycles.save(cycle);
    }

    await this.recordAudit(BillingCycleAuditAction.APPROVE, id, oldValue, cycle, actorId);
    return this.findOne(id);
  }

  async reject(id: number, dto: RejectBillingCycleDto, actorId?: number, actorRole?: string) {
    const cycle = await this.billingCycles.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!cycle) throw new NotFoundException('Billing cycle not found');
    if (cycle.status !== BillingCycleStatus.PENDING) {
      throw new BadRequestException('Only a pending billing cycle version can be rejected');
    }
    this.assertOnlyFinanceMayReview(actorRole, 'reject');
    this.assertNotSelfReview(cycle, actorId, 'rejected');

    const oldValue = { ...cycle };
    cycle.status = BillingCycleStatus.REJECTED;
    cycle.rejectionNotes = dto.notes;
    if (actorId) cycle.approvedBy = { id: actorId } as any;
    cycle.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.billingCycles.save(cycle);
    await this.recordAudit(BillingCycleAuditAction.REJECT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // The only way out of REJECTED — re-enters the Finance approval queue
  // after Super Admin/Admin fixes whatever the rejection notes called out
  // (via a plain update() first, then resubmit()). Without this, REJECTED
  // would be a dead end with no way back into review.
  async resubmit(id: number, actorId?: number) {
    const cycle = await this.billingCycles.findOne({ where: { id } });
    if (!cycle) throw new NotFoundException('Billing cycle not found');
    if (cycle.status !== BillingCycleStatus.REJECTED) {
      throw new BadRequestException('Only a rejected billing cycle version can be resubmitted');
    }

    const oldValue = { ...cycle };
    cycle.status = BillingCycleStatus.PENDING;
    cycle.rejectionNotes = null;
    cycle.approvedBy = null;
    cycle.approvalDate = null;
    if (actorId) cycle.submittedBy = { id: actorId } as any;
    cycle.submittedOn = new Date().toISOString().slice(0, 10);
    const saved = await this.billingCycles.save(cycle);
    await this.recordAudit(BillingCycleAuditAction.RESUBMIT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // Super Admin only — the intended lifecycle-end action for a billing
  // cycle. Replaces the old unconditional soft-delete: a governing cycle
  // should be superseded and audited, not silently removed. Per the doc,
  // "effective deprecation date... must be after current cycle end date" —
  // implying the cycle keeps running until then, not that it dies on
  // request. A same-day date deprecates now; a future date only records the
  // decision (status untouched) and BillingCycleSchedulerService applies it
  // for real once that date arrives — see applyDeprecation()/autoDeprecateDueCycles().
  async deprecate(id: number, dto: DeprecateBillingCycleDto, actorId?: number) {
    const cycle = await this.billingCycles.findOne({ where: { id }, relations: ['childVersions'] });
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

    // Mandatory on every deprecation, regardless of replacement status —
    // "user must confirm they understand billing will stop for this
    // property" (doc: Mandatory inputs before deprecation is confirmed).
    if (!dto.acknowledged) {
      throw new BadRequestException('You must acknowledge that billing will stop for this property before deprecating.');
    }

    // "Effective deprecation date — cannot be a past date"
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
      const saved = await this.billingCycles.save(cycle);
      await this.recordAudit(BillingCycleAuditAction.SCHEDULE_DEPRECATION, id, oldValue, saved, actorId);
    }

    return this.findOne(id);
  }

  // The single place `status` is ever set to DEPRECATED — reused by the
  // immediate path in deprecate() above, by autoDeprecateDueCycles() below,
  // and by activateVersion()'s auto-supersede case, so there is exactly one
  // implementation of "what deprecating a row means" in this service.
  private async applyDeprecation(
    cycle: BillingCycle,
    reasonCode: string,
    notes: string | null,
    effectiveDate: string,
  ): Promise<BillingCycle> {
    cycle.status = BillingCycleStatus.DEPRECATED;
    cycle.deprecationReasonCode = reasonCode;
    cycle.deprecationNotes = notes;
    cycle.deprecatedOn = effectiveDate;
    return this.billingCycles.save(cycle);
  }

  // True once deprecate() has recorded a future-dated decision that hasn't
  // been applied yet — blocks a second, conflicting deprecate() call.
  private hasScheduledDeprecation(cycle: BillingCycle): boolean {
    const today = new Date().toISOString().slice(0, 10);
    return !!cycle.deprecatedOn && cycle.deprecatedOn > today && cycle.status !== BillingCycleStatus.DEPRECATED;
  }

  // Exposed for the scheduler — applies every deprecation that deprecate()
  // recorded with a future effectiveDeprecationDate which has now arrived.
  async autoDeprecateDueCycles(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const due = await this.billingCycles
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

  // Shared by approve() (same-day case) and the scheduler (future-date
  // catch-up): activates a pending version and deprecates the version it
  // replaces, if any. `actorId` is undefined when called by the scheduler,
  // which the audit trail then records as system-initiated.
  private async activateVersion(cycle: BillingCycle, actorId?: number): Promise<BillingCycle> {
    cycle.status = BillingCycleStatus.ACTIVE;
    const saved = await this.billingCycles.save(cycle);

    const parentId = cycle.parentBillingCycle?.id;
    if (parentId) {
      const parent = await this.billingCycles.findOne({ where: { id: parentId } });
      if (parent && parent.status !== BillingCycleStatus.DEPRECATED) {
        const parentOldValue = { ...parent };
        const savedParent = await this.applyDeprecation(
          parent,
          'replaced-by-new-version',
          null,
          new Date().toISOString().slice(0, 10),
        );
        await this.recordAudit(
          actorId ? BillingCycleAuditAction.DEPRECATE : BillingCycleAuditAction.AUTO_DEPRECATE,
          parent.id,
          parentOldValue,
          savedParent,
          actorId,
        );
      }
    }

    return saved;
  }

  // Exposed for the scheduler — promotes every approved-but-still-pending
  // version whose effectiveFrom date has arrived.
  async autoActivateDueVersions(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const due = await this.billingCycles
      .createQueryBuilder('bc')
      .leftJoinAndSelect('bc.parentBillingCycle', 'parentBillingCycle')
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

  // "Free text notes mandatory if OTHER is selected" — applies to any
  // reason-code dropdown in this module (plain edits, new versions, deprecation).
  private assertNotesRequiredForOtherReason(reasonCode: string, notes: string | null | undefined): void {
    if (reasonCode === 'other' && !notes?.trim()) {
      throw new BadRequestException('Notes are required when selecting "Other" as the reason.');
    }
  }

  private assertNoLockedFields(dto: UpdateBillingCycleDto): void {
    const locked = LOCKED_BILLING_CYCLE_FIELDS.filter((field) => (dto as Record<string, unknown>)[field] !== undefined);
    if (locked.length) {
      throw new BadRequestException(
        `Cannot change ${locked.join(', ')} on an existing billing cycle — create a new version instead.`,
      );
    }
  }

  // A plain update() only ever means "turn this cycle on/off" for status —
  // it must never be usable to fast-track a PENDING/REJECTED version to
  // ACTIVE (that's approve()'s job) or to DEPRECATED (that's deprecate()'s,
  // with its own reason-code and no-alternative-cycle checks). Without this,
  // Business Rule 4's Finance approval gate could be bypassed entirely.
  private assertToggleOnlyStatusChange(bc: BillingCycle, dto: UpdateBillingCycleDto): void {
    if (dto.status === undefined) return;
    const isToggle = dto.status === BillingCycleStatus.ACTIVE || dto.status === BillingCycleStatus.INACTIVE;
    const currentIsToggleable = bc.status === BillingCycleStatus.ACTIVE || bc.status === BillingCycleStatus.INACTIVE;
    if (!isToggle || !currentIsToggleable) {
      throw new BadRequestException(
        'Status can only be toggled between active and inactive on an already active or inactive billing cycle — use approve, reject, or deprecate for other transitions.',
      );
    }
  }

  private assertOnlyFinanceMayReview(actorRole: string | undefined, action: 'approve' | 'reject'): void {
    if (actorRole !== ROLES.FINANCE) {
      throw new ForbiddenException(`Only the Finance role can ${action} a billing cycle version — Super Admin and Admin are excluded by design.`);
    }
  }

  private assertNotSelfReview(cycle: BillingCycle, actorId: number | undefined, action: 'approved' | 'rejected'): void {
    if (actorId && cycle.submittedBy?.id === actorId) {
      throw new BadRequestException(
        `A billing cycle version cannot be ${action} by the same user who submitted it. Ask another reviewer to action it.`,
      );
    }
  }

  private nextMajorVersion(current: string): string {
    const major = parseInt(current.split('.')[0], 10);
    return `${Number.isFinite(major) ? major + 1 : 2}.0`;
  }

  private async recordAudit(
    action: BillingCycleAuditAction,
    entityId: number,
    oldValue: unknown,
    newValue: unknown,
    actorId?: number,
  ): Promise<void> {
    await this.auditService.record({
      moduleName: BILLING_CYCLE_AUDIT_MODULE_NAME,
      entityId,
      action,
      oldValue,
      newValue,
      performedBy: actorId,
    });
  }
}

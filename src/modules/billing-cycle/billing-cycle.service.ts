import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { assertNotSelfReview, nextMajorVersion } from '../../common/utils/versioning.util';
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
import { BillingCycleMaster } from './entities/billing-cycle-master.entity';
import { BillingCycleVersion, BillingCycleStatus } from './entities/billing-cycle-version.entity';
import {
  BILLING_CYCLE_AUDIT_MODULE_NAME,
  BILLING_CYCLE_CHANGE_REASON_LOV_CATEGORY,
  BILLING_CYCLE_DEPRECATION_REASON_LOV_CATEGORY,
  BillingCycleAuditAction,
  EDITABLE_BILLING_CYCLE_STATUSES,
  LOCKED_BILLING_CYCLE_FIELDS,
  NEW_VERSION_SOURCE_STATUSES,
  REQUIRE_CHANGE_REASON_ON_EDIT_ATTRIBUTE_KEY,
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

  private computeBillDueDateObj(cycle: Pick<BillingCycleVersion, 'readingEndDay' | 'billIssueDays' | 'billDueDays'>): Date | null {
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

  private formatBillDueDate(cycle: Pick<BillingCycleVersion, 'readingEndDay' | 'billIssueDays' | 'billDueDays'>): string | null {
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

  private mapToResponse(v: BillingCycleVersion) {
    const name = (user?: { firstName: string; lastName: string } | null) =>
      user ? `${user.firstName} ${user.lastName}`.trim() : null;
    const master = v.master;

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
      billDueDate: this.formatBillDueDate(v),
      status: v.status,
      version: v.version,
      parentBillingCycleId: v.parentVersion?.id ?? null,
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

  // Creates the master (if this property has never had one) plus its first
  // version — or, if this property's master already exists but nothing is
  // currently governing it (every prior version deprecated), adds the next
  // version onto that SAME master instead of fragmenting into a second,
  // disconnected master for the same property.
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
        // A newly created cycle immediately governs its property (no
        // approval gate applies to initial creation — that's Business Rule
        // 4's territory, which only covers newVersion()) and Active is what
        // getStats()/dashboard due-date calculations actually key off, so a
        // freshly created cycle must default to Active to take effect at
        // all rather than silently billing nothing until someone remembers
        // to flip it on.
        status: dto.status ?? BillingCycleStatus.ACTIVE,
        version: versionNumber,
      });
      const savedVersion = await manager.save(BillingCycleVersion, versionEntity);

      master.currentVersionId = savedVersion.id;
      await manager.save(BillingCycleMaster, master);

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

  async findOne(id: number) {
    const bc = await this.versions.findOne({
      where: { id },
      relations: VERSION_RESPONSE_RELATIONS,
    });
    if (!bc) throw new NotFoundException('Billing cycle not found');
    return this.mapToResponse(bc);
  }

  // Direct FK lookup to whichever version is currently governing this
  // property — the whole reason BillingCycleMaster.currentVersionId exists.
  // Replaces the old single-table design's "prefer ACTIVE, else most recent
  // non-deprecated" scan with an O(1) pointer dereference.
  async findByProperty(propertyId: number) {
    const master = await this.masters.findOne({ where: { propertyId } });
    if (!master?.currentVersionId) {
      throw new NotFoundException('Billing cycle not found for this property');
    }
    return this.findOne(master.currentVersionId);
  }

  async update(id: number, dto: UpdateBillingCycleDto, actorId?: number) {
    const bc = await this.versions.findOne({
      where: { id },
      relations: VERSION_RESPONSE_RELATIONS,
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

    const saved = await this.versions.save(bc);

    await this.recordAudit(BillingCycleAuditAction.UPDATE, id, oldValue, { ...fields, reasonForChange, reasonCode }, actorId);

    return this.mapToResponse(saved);
  }

  // Business Rule 3/5 — the only way to change the reading window: clone the
  // property's current governing version into a new PENDING version awaiting
  // Finance approval, effective from a not-yet-reached date. Always lands
  // under the SAME master as its source — never creates a new master.
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
      return manager.save(BillingCycleVersion, clone);
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

  async approve(id: number, actorId?: number) {
    const cycle = await this.versions.findOne({
      where: { id },
      relations: ['submittedBy', 'parentVersion'],
    });
    if (!cycle) throw new NotFoundException('Billing cycle not found');
    if (cycle.status !== BillingCycleStatus.PENDING) {
      throw new BadRequestException('Only a pending billing cycle version can be approved');
    }
    // Who may approve is entirely a Role Permissions decision
    // (BILLING_CYCLE_APPROVE grant), enforced by PermissionGuard at the
    // route — no hardcoded role check here. assertNotSelfReview is a
    // separate, role-independent maker-checker rule and stays regardless of
    // who holds the grant.
    assertNotSelfReview(cycle.submittedBy?.id, actorId, 'approved');

    const oldValue = { ...cycle };
    if (actorId) cycle.approvedBy = { id: actorId } as any;
    cycle.approvalDate = new Date().toISOString().slice(0, 10);

    const today = new Date().toISOString().slice(0, 10);
    if (cycle.effectiveFrom && cycle.effectiveFrom <= today) {
      // The effective date has already arrived — activate immediately
      // rather than leaving it stuck in PENDING until the next midnight sweep.
      await this.activateVersion(cycle, actorId);
    } else {
      await this.versions.save(cycle);
    }

    await this.recordAudit(BillingCycleAuditAction.APPROVE, id, oldValue, cycle, actorId);
    return this.findOne(id);
  }

  async reject(id: number, dto: RejectBillingCycleDto, actorId?: number) {
    const cycle = await this.versions.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!cycle) throw new NotFoundException('Billing cycle not found');
    if (cycle.status !== BillingCycleStatus.PENDING) {
      throw new BadRequestException('Only a pending billing cycle version can be rejected');
    }
    // Who may reject is entirely a Role Permissions decision
    // (BILLING_CYCLE_REJECT grant), enforced by PermissionGuard at the
    // route — no hardcoded role check here. assertNotSelfReview is a
    // separate, role-independent maker-checker rule and stays regardless of
    // who holds the grant.
    assertNotSelfReview(cycle.submittedBy?.id, actorId, 'rejected');

    const oldValue = { ...cycle };
    cycle.status = BillingCycleStatus.REJECTED;
    cycle.rejectionNotes = dto.notes;
    if (actorId) cycle.approvedBy = { id: actorId } as any;
    cycle.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.versions.save(cycle);
    await this.recordAudit(BillingCycleAuditAction.REJECT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // The only way out of REJECTED — re-enters the Finance approval queue
  // after Super Admin/Admin fixes whatever the rejection notes called out
  // (via a plain update() first, then resubmit()). Without this, REJECTED
  // would be a dead end with no way back into review.
  async resubmit(id: number, actorId?: number) {
    const cycle = await this.versions.findOne({ where: { id } });
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
    const saved = await this.versions.save(cycle);
    await this.recordAudit(BillingCycleAuditAction.RESUBMIT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // Super Admin only — the intended lifecycle-end action for a billing
  // cycle version. Replaces the old unconditional soft-delete: a governing
  // version should be superseded and audited, not silently removed. Per
  // the doc, "effective deprecation date... must be after current cycle
  // end date" — implying the version keeps running until then, not that it
  // dies on request. A same-day date deprecates now; a future date only
  // records the decision (status untouched) and BillingCycleSchedulerService
  // applies it for real once that date arrives.
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
      const saved = await this.versions.save(cycle);
      await this.recordAudit(BillingCycleAuditAction.SCHEDULE_DEPRECATION, id, oldValue, saved, actorId);
    }

    return this.findOne(id);
  }

  // The single place `status` is ever set to DEPRECATED — reused by the
  // immediate path in deprecate() above, by autoDeprecateDueCycles() below,
  // and by activateVersion()'s auto-supersede case, so there is exactly one
  // implementation of "what deprecating a row means" in this service. Also
  // the single place that clears BillingCycleMaster.currentVersionId when
  // the version being deprecated was the one currently governing.
  private async applyDeprecation(
    cycle: BillingCycleVersion,
    reasonCode: string,
    notes: string | null,
    effectiveDate: string,
  ): Promise<BillingCycleVersion> {
    cycle.status = BillingCycleStatus.DEPRECATED;
    cycle.deprecationReasonCode = reasonCode;
    cycle.deprecationNotes = notes;
    cycle.deprecatedOn = effectiveDate;
    const saved = await this.versions.save(cycle);

    const master = await this.masters.findOne({ where: { id: cycle.masterId } });
    if (master && master.currentVersionId === cycle.id) {
      master.currentVersionId = null;
      await this.masters.save(master);
    }

    return saved;
  }

  // True once deprecate() has recorded a future-dated decision that hasn't
  // been applied yet — blocks a second, conflicting deprecate() call.
  private hasScheduledDeprecation(cycle: BillingCycleVersion): boolean {
    const today = new Date().toISOString().slice(0, 10);
    return !!cycle.deprecatedOn && cycle.deprecatedOn > today && cycle.status !== BillingCycleStatus.DEPRECATED;
  }

  // Exposed for the scheduler — applies every deprecation that deprecate()
  // recorded with a future effectiveDeprecationDate which has now arrived.
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

  // Shared by approve() (same-day case) and the scheduler (future-date
  // catch-up): activates a pending version, points its master's
  // currentVersionId at it, and deprecates the version it replaces, if any.
  // `actorId` is undefined when called by the scheduler, which the audit
  // trail then records as system-initiated.
  //
  // Order matters here: the master's pointer is moved to the NEW version
  // before the OLD one is deprecated, so applyDeprecation()'s "clear the
  // pointer if it still points at me" check on the old version correctly
  // finds it already pointing elsewhere and leaves it alone.
  private async activateVersion(cycle: BillingCycleVersion, actorId?: number): Promise<BillingCycleVersion> {
    cycle.status = BillingCycleStatus.ACTIVE;
    const saved = await this.versions.save(cycle);

    const master = await this.masters.findOne({ where: { id: cycle.masterId } });
    if (master) {
      master.currentVersionId = cycle.id;
      await this.masters.save(master);
    }

    const parentId = cycle.parentVersion?.id;
    if (parentId) {
      const parent = await this.versions.findOne({ where: { id: parentId } });
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
  private assertToggleOnlyStatusChange(bc: BillingCycleVersion, dto: UpdateBillingCycleDto): void {
    if (dto.status === undefined) return;
    const isToggle = dto.status === BillingCycleStatus.ACTIVE || dto.status === BillingCycleStatus.INACTIVE;
    const currentIsToggleable = bc.status === BillingCycleStatus.ACTIVE || bc.status === BillingCycleStatus.INACTIVE;
    if (!isToggle || !currentIsToggleable) {
      throw new BadRequestException(
        'Status can only be toggled between active and inactive on an already active or inactive billing cycle — use approve, reject, or deprecate for other transitions.',
      );
    }
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

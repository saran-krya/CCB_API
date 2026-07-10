import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AttributeService } from '../attribute/attribute.service';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import {
  assertNotSelfReview,
  nextMajorVersion,
  nextMinorVersion,
} from '../../common/utils/versioning.util';
import { LovService } from '../lov/lov.service';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import {
  CreateTariffDto,
  RejectTariffDto,
  TariffConflictQueryDto,
  TariffQueryDto,
  TariffTierDto,
  UpdateTariffDto,
} from './dto/tariff.dto';
import { TariffMaster } from './entities/tariff-master.entity';
import { TariffTier } from './entities/tariff-tier.entity';
import {
  TariffApplicability,
  TariffPenaltyType,
  TariffRateType,
  TariffStatus,
  TariffVersion,
} from './entities/tariff-version.entity';
import { TARIFF_FIELD_METADATA } from './tariff-field-metadata';
import {
  ACTIVE_LOCKED_TARIFF_FIELDS,
  DEFAULT_VAT_RATE_FALLBACK,
  EDITABLE_TARIFF_STATUSES,
  SORTABLE_TARIFF_FIELDS,
  SUBMITTABLE_TARIFF_STATUSES,
  TARIFF_AUDIT_MODULE_NAME,
  TARIFF_REJECTION_REASON_LOV_CATEGORY,
  TARIFF_SORT_COLUMN_MAP,
  TARIFF_UNIT_TYPE_COMMERCIAL,
  TARIFF_UNIT_TYPE_LOV_CATEGORY,
  TARIFF_UNIT_TYPE_RESIDENTIAL,
  TariffAuditAction,
  TariffValidationIssue,
} from './tariff.constants';

const VERSION_RESPONSE_RELATIONS = [
  'master',
  'submittedBy',
  'approvedBy',
  'tiers',
  'properties',
  'properties.community',
  'units',
  'parentVersion',
];

@Injectable()
export class TariffService {
  constructor(
    @InjectRepository(TariffMaster) private readonly masters: Repository<TariffMaster>,
    @InjectRepository(TariffVersion) private readonly versions: Repository<TariffVersion>,
    @InjectRepository(Property) private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly attributeService: AttributeService,
    private readonly lovService: LovService,
  ) {}

  async checkConflict(query: TariffConflictQueryDto) {
    const qb = this.versions
      .createQueryBuilder('version')
      .leftJoinAndSelect('version.master', 'master')
      .leftJoinAndSelect('version.properties', 'properties')
      .leftJoinAndSelect('version.units', 'units')
      .where('version.propertyType = :propertyType', { propertyType: query.propertyType })
      .andWhere('version.status IN (:...statuses)', {
        statuses: [TariffStatus.ACTIVE, TariffStatus.PENDING, TariffStatus.REQUEST_FOR_CORRECTION],
      });

    if (query.excludeId) {
      qb.andWhere('version.id != :excludeId', { excludeId: query.excludeId });
    }
    if (query.effectiveFrom) {
      qb.andWhere('(version.effective_to IS NULL OR version.effective_to >= :from)', {
        from: query.effectiveFrom,
      });
    }
    if (query.effectiveTo) {
      qb.andWhere('(version.effective_from IS NULL OR version.effective_from <= :to)', {
        to: query.effectiveTo,
      });
    }

    const candidates = await qb.getMany();
    if (!candidates.length) {
      return { status: 'no-conflict' as const, conflictingTariff: null };
    }

    const queryPropertyIds = new Set(query.propertyIds ?? []);
    const queryUnitIds = new Set(query.unitIds ?? []);

    let unitPropertyIds = new Set<number>();
    if (query.applicability === TariffApplicability.UNIT && queryUnitIds.size) {
      const units = await this.unitRepo.find({
        where: { id: In([...queryUnitIds]) },
        relations: ['property'],
      });
      unitPropertyIds = new Set(units.map((u) => u.property.id));
    }

    const isExactMatch = (v: TariffVersion): boolean => {
      if (v.applicability !== query.applicability) return false;
      if (v.applicability === TariffApplicability.GLOBAL) return true;
      if (v.applicability === TariffApplicability.PROPERTY) {
        const existingIds = new Set(v.properties.map((p) => p.id));
        return existingIds.size === queryPropertyIds.size && [...existingIds].every((id) => queryPropertyIds.has(id));
      }
      const existingIds = new Set(v.units.map((u) => u.id));
      return existingIds.size === queryUnitIds.size && [...existingIds].every((id) => queryUnitIds.has(id));
    };

    const isBroaderScope = (v: TariffVersion): boolean => {
      if (query.applicability === TariffApplicability.GLOBAL) return false;
      if (v.applicability === TariffApplicability.GLOBAL) return true;
      if (v.applicability === TariffApplicability.PROPERTY && query.applicability === TariffApplicability.UNIT) {
        return v.properties.some((p) => unitPropertyIds.has(p.id));
      }
      return false;
    };

    const exact = candidates.find(isExactMatch);
    if (exact) {
      return { status: 'exact-conflict' as const, conflictingTariff: this.toConflictSummary(exact) };
    }

    const override = candidates.find(isBroaderScope);
    if (override) {
      return { status: 'override-warning' as const, conflictingTariff: this.toConflictSummary(override) };
    }

    return { status: 'no-conflict' as const, conflictingTariff: null };
  }

  private toConflictSummary(version: TariffVersion) {
    return {
      id: version.id,
      code: version.master?.businessCode ?? null,
      name: version.name,
      applicability: version.applicability,
    };
  }

  async getFilterMetadata() {
    const [properties, unitTypes, activeLockedFields] = await Promise.all([
      this.propertyRepo.find({
        relations: ['community'],
        order: { name: 'ASC' },
      }),
      this.lovService.findByCategory(TARIFF_UNIT_TYPE_LOV_CATEGORY),
      this.getActiveLockedFields(),
    ]);

    return {
      statuses: Object.values(TariffStatus).map((value) => ({ value, label: this.labelize(value) })),
      propertyTypes: unitTypes.map((v) => ({ value: v.code, label: v.label })),
      rateTypes: Object.values(TariffRateType).map((value) => ({ value, label: this.labelize(value) })),
      applicabilities: Object.values(TariffApplicability).map((value) => ({ value, label: this.labelize(value) })),
      properties: properties.map((property) => ({
        id: property.id,
        name: property.name,
        communityName: property.community?.name ?? null,
      })),
      // Every wizard field's business rules (required/min/max/allowZero/...)
      // in one place — see TARIFF_FIELD_METADATA's own comment. The wizard's
      // `*` indicators, HTML5 min/max attributes and step-completion checks
      // all read from this instead of a hand-duplicated copy, so they can
      // never drift from what the DTO actually enforces.
      fieldMetadata: TARIFF_FIELD_METADATA,
      // Business-Admin-configurable via Attributes > Tariff Config — see
      // getActiveLockedFields(). Lets the wizard grey out / footnote exactly
      // the fields the backend will actually reject on an active tariff.
      activeLockedFields,
    };
  }

  async getStats() {
    const [statusCounts, total] = await Promise.all([
      this.versions
        .createQueryBuilder('version')
        .select('version.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('version.status')
        .getRawMany<{ status: TariffStatus; count: string }>(),
      this.versions.count(),
    ]);
    const countFor = (status: TariffStatus) => Number(statusCounts.find((row) => row.status === status)?.count ?? 0);
    const active = countFor(TariffStatus.ACTIVE);
    const pending = countFor(TariffStatus.PENDING);
    const inactive = countFor(TariffStatus.INACTIVE);
    const rejected = countFor(TariffStatus.REJECTED);
    const draft = countFor(TariffStatus.DRAFT);
    const requestForCorrection = countFor(TariffStatus.REQUEST_FOR_CORRECTION);
    const deprecated = countFor(TariffStatus.DEPRECATED);
    const expired = countFor(TariffStatus.EXPIRED);

    const rawBreakdown = await this.versions
      .createQueryBuilder('version')
      .select('version.applicability', 'applicability')
      .addSelect('version.property_type', 'propertyType')
      .addSelect('COUNT(*)', 'count')
      .where('version.status = :status', { status: TariffStatus.ACTIVE })
      .groupBy('version.applicability')
      .addGroupBy('version.property_type')
      .getRawMany<{ applicability: string; propertyType: string; count: string }>();

    const applicabilityBreakdown = Object.values(TariffApplicability).map((applicability) => {
      const row = { applicability: this.labelize(applicability), residential: 0, commercial: 0 };
      rawBreakdown
        .filter((entry) => entry.applicability === applicability)
        .forEach((entry) => {
          if (entry.propertyType === TARIFF_UNIT_TYPE_RESIDENTIAL) row.residential = Number(entry.count);
          if (entry.propertyType === TARIFF_UNIT_TYPE_COMMERCIAL) row.commercial = Number(entry.count);
        });
      return row;
    });

    return {
      total,
      active,
      pending,
      inactive,
      rejected,
      draft,
      requestForCorrection,
      deprecated,
      expired,
      statusDistribution: [
        { key: 'draft', label: 'Draft', value: draft },
        { key: 'pending', label: 'Pending', value: pending },
        { key: 'requestForCorrection', label: 'Request for Correction', value: requestForCorrection },
        { key: 'active', label: 'Active', value: active },
        { key: 'inactive', label: 'Inactive', value: inactive },
        { key: 'deprecated', label: 'Deprecated', value: deprecated },
        { key: 'expired', label: 'Expired', value: expired },
        { key: 'rejected', label: 'Rejected', value: rejected },
      ],
      applicabilityBreakdown,
    };
  }

  async findAll(query: TariffQueryDto) {
    const qb = this.versions
      .createQueryBuilder('version')
      .leftJoinAndSelect('version.master', 'master')
      .leftJoinAndSelect('version.submittedBy', 'submittedBy')
      .leftJoinAndSelect('version.approvedBy', 'approvedBy')
      .leftJoinAndSelect('version.properties', 'properties');

    if (query.search) {
      qb.andWhere('(version.name LIKE :search OR master.business_code LIKE :search)', {
        search: `%${query.search}%`,
      });
    }
    if (query.status) qb.andWhere('version.status = :status', { status: query.status });
    if (query.propertyType) {
      qb.andWhere('version.property_type = :propertyType', { propertyType: query.propertyType });
    }
    if (query.rateType) qb.andWhere('version.rate_type = :rateType', { rateType: query.rateType });
    if (query.applicability) {
      qb.andWhere('version.applicability = :applicability', { applicability: query.applicability });
    }

    const sortBy = query.sortBy && SORTABLE_TARIFF_FIELDS.has(query.sortBy) ? query.sortBy : 'createdAt';
    qb.orderBy(TARIFF_SORT_COLUMN_MAP[sortBy], query.sortOrder ?? 'DESC');

    const result = await paginate(qb, query);

    // tiers/units are deliberately NOT joined into the paginated query above
    // — a leftJoinAndSelect on a to-many relation combined with skip/take
    // multiplies rows before TypeORM re-groups them, which can silently
    // shrink or corrupt a page. A second, un-paginated aggregate query
    // scoped to just this page's ids has no such hazard and stays cheap.
    const counts = await this.getRelationCounts(result.items.map((v) => v.id));

    return {
      ...result,
      items: result.items.map((version) => this.mapToResponse(version, false, counts.get(version.id))),
    };
  }

  private async getRelationCounts(versionIds: number[]): Promise<Map<number, { tierCount: number; unitCount: number }>> {
    if (!versionIds.length) return new Map();
    const rows = await this.dataSource.query(
      `SELECT v.id,
              COUNT(DISTINCT t.id) AS tierCount,
              COUNT(DISTINCT u.unit_id) AS unitCount
       FROM tariff_versions v
       LEFT JOIN tariff_tiers t ON t.tariff_id = v.id
       LEFT JOIN tariff_units u ON u.tariff_id = v.id
       WHERE v.id IN (?)
       GROUP BY v.id`,
      [versionIds],
    );
    return new Map(rows.map((r: any) => [Number(r.id), { tierCount: Number(r.tierCount), unitCount: Number(r.unitCount) }]));
  }

  async findOne(id: number) {
    const version = await this.versions.findOne({
      where: { id },
      relations: VERSION_RESPONSE_RELATIONS,
    });
    if (!version) throw new NotFoundException('Tariff not found');
    return this.mapToResponse(version, true);
  }

  // Every version of the same lineage (same master), oldest first — the
  // "Visible in tariff history for audit purposes" requirement for a
  // deprecated tariff, generalized to work from any version's detail page,
  // not just the deprecated one. Lightweight by design: full detail is
  // already one click away via each row's own id.
  async getVersionHistory(id: number) {
    const version = await this.versions.findOne({ where: { id } });
    if (!version) throw new NotFoundException('Tariff not found');

    const lineage = await this.versions.find({
      where: { masterId: version.masterId },
      relations: ['submittedBy', 'approvedBy'],
      order: { id: 'ASC' },
    });

    return lineage.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      isCurrent: v.id === version.id,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      submittedBy: this.formatUserName(v.submittedBy),
      submittedOn: v.submittedOn,
      approvedBy: this.formatUserName(v.approvedBy),
      approvalDate: v.approvalDate,
      createdAt: v.createdAt,
    }));
  }

  // The DTO only checks propertyType is a non-empty string (it's dynamic, not
  // a fixed enum) — this confirms it's actually an active code in the
  // Lookup Field Master's TARIFF_UNIT_TYPE category, the same source the
  // create-form dropdown and list filter both read from.
  private async assertValidUnitType(propertyType: string): Promise<void> {
    const validValues = await this.lovService.findByCategory(TARIFF_UNIT_TYPE_LOV_CATEGORY);
    if (!validValues.some((v) => v.code === propertyType)) {
      throw new BadRequestException(
        `"${propertyType}" is not a configured unit type. Add it under Lookup Field Master (TARIFF_UNIT_TYPE) first.`,
      );
    }
  }

  // The DTO only checks rejectionReason is a non-empty string — this
  // confirms it's actually an active code in the Lookup Field Master's
  // TARIFF_REJECTION_REASON category, the same source the Reject dialog's
  // dropdown reads from — identical reasoning to assertValidUnitType above.
  private async assertValidRejectionReason(rejectionReason: string): Promise<void> {
    const validValues = await this.lovService.findByCategory(TARIFF_REJECTION_REASON_LOV_CATEGORY);
    if (!validValues.some((v) => v.code === rejectionReason)) {
      throw new BadRequestException(
        `"${rejectionReason}" is not a configured rejection reason. Add it under Lookup Field Master (TARIFF_REJECTION_REASON) first.`,
      );
    }
  }

  // Whether a tier SET exists at all is a completeness concern (deferrable
  // to a Draft — see getValidationIssues); whether the tiers that DO exist
  // make sense as a slab structure is not, and is rejected immediately
  // whenever tiers are provided, same as any other malformed input. Returns
  // the tiers sorted by minKwh — callers persist THIS order (not whatever
  // order the client happened to send), so tierOrder always follows the
  // consumption progression regardless of client-side array order.
  private assertTiersValid(tiers: TariffTierDto[]): TariffTierDto[] {
    const sorted = [...tiers].sort((a, b) => a.minKwh - b.minKwh);
    sorted.forEach((tier, index) => {
      const isLast = index === sorted.length - 1;
      if (!isLast && (tier.maxKwh === null || tier.maxKwh === undefined)) {
        throw new BadRequestException(
          `Tier ${index + 1} (${tier.minKwh}–${tier.maxKwh ?? '∞'} kWh) must have a maximum — only the last tier may be open-ended.`,
        );
      }
      if (index > 0) {
        const previous = sorted[index - 1];
        if (tier.minKwh < (previous.maxKwh ?? 0)) {
          throw new BadRequestException(
            `Tier ${index + 1}'s minimum (${tier.minKwh} kWh) overlaps tier ${index}'s range (up to ${previous.maxKwh} kWh).`,
          );
        }
      }
    });
    return sorted;
  }

  // Rate/scope shape is intentionally NOT validated here — a tariff can be
  // created as an incomplete draft (e.g. the wizard creates it right after
  // Step 1, before Step 2's rate values exist). submit() re-validates the
  // full persisted entity via getValidationIssues before it's allowed into
  // the approval queue, which is the point completeness actually matters.
  //
  // Every create() call starts a brand-new lineage — a new TariffMaster with
  // its own business code plus that master's first (v1.0) version — since,
  // unlike a property's billing cycle, there is no natural "one tariff per X"
  // identity for a fresh tariff to be reconciled against.
  async create(dto: CreateTariffDto, actorId?: number) {
    await this.assertValidUnitType(dto.propertyType);
    const sortedTiers = dto.rateType === TariffRateType.TIERED && dto.tiers && dto.tiers.length > 0
      ? this.assertTiersValid(dto.tiers)
      : undefined;

    const defaultVat = await this.getDefaultVat();

    const savedId = await this.dataSource.transaction(async (manager) => {
      let master = await manager.save(TariffMaster, manager.create(TariffMaster, {}));
      master.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.TARIFF, master.id);
      master = await manager.save(TariffMaster, master);

      const version = manager.create(TariffVersion, {
        masterId: master.id,
        name: dto.name,
        status: TariffStatus.DRAFT,
        version: '1.0',
        propertyType: dto.propertyType,
        rateType: dto.rateType,
        applicability: dto.applicability,
        flatRate: dto.rateType === TariffRateType.FLAT ? dto.flatRate : null,
        billingServiceFee: dto.billingServiceFee ?? 0,
        activationFee: dto.activationFee ?? 0,
        securityDeposit: dto.securityDeposit ?? 0,
        latePaymentPenaltyType: dto.latePaymentPenaltyType ?? TariffPenaltyType.FLAT,
        latePaymentPenalty: dto.latePaymentPenalty ?? 0,
        disconnectionFee: dto.disconnectionFee ?? 0,
        reconnectionFee: dto.reconnectionFee ?? 0,
        tamperingPenalty: dto.tamperingPenalty ?? 0,
        bouncedChequeFee: dto.bouncedChequeFee ?? 0,
        nocFee: dto.nocFee ?? 0,
        moveOutFee: dto.moveOutFee ?? 0,
        meterVerificationFee: dto.meterVerificationFee ?? 0,
        meterRentalEnabled: dto.meterRentalEnabled ?? false,
        meterRentalFee: dto.meterRentalFee ?? 0,
        vat: dto.vat ?? defaultVat,
        vatRegistrationNumber: dto.vatRegistrationNumber ?? null,
        vatApplicableFees: dto.vatApplicableFees ?? null,
        effectiveFrom: dto.effectiveFrom ?? null,
        effectiveTo: dto.effectiveTo ?? null,
        description: dto.description ?? null,
      });

      if (dto.applicability === TariffApplicability.PROPERTY && dto.propertyIds?.length) {
        version.properties = await this.findPropertiesOrFail(manager, dto.propertyIds);
      }
      if (dto.applicability === TariffApplicability.UNIT && dto.unitIds?.length) {
        version.units = await this.findUnitsOrFail(manager, dto.unitIds);
      }

      const saved = await manager.save(TariffVersion, version);

      if (sortedTiers) {
        const tierRows = sortedTiers.map((tier, index) =>
          manager.create(TariffTier, {
            version: saved,
            tierOrder: index + 1,
            minKwh: tier.minKwh,
            maxKwh: tier.maxKwh ?? null,
            ratePerKwh: tier.ratePerKwh,
          }),
        );
        await manager.save(TariffTier, tierRows);
      }

      await this.audit(TariffAuditAction.CREATE, saved.id, null, saved, actorId);

      return saved.id;
    });

    return this.findOne(savedId);
  }

  async update(id: number, dto: UpdateTariffDto, actorId?: number) {
    const version = await this.versions.findOne({
      where: { id },
      relations: ['tiers', 'properties', 'units', 'submittedBy'],
    });
    if (!version) throw new NotFoundException('Tariff not found');

    // PENDING is locked unconditionally — not even the submitter can edit
    // it while Finance review is in progress; Finance must Approve or
    // Reject first (see EDITABLE_TARIFF_STATUSES).
    if (!EDITABLE_TARIFF_STATUSES.has(version.status)) {
      throw new BadRequestException(
        version.status === TariffStatus.PENDING
          ? 'A tariff awaiting Finance approval is read-only — approve, reject, or wait for a decision.'
          : `A tariff with status "${this.labelize(version.status)}" is read-only and cannot be edited.`,
      );
    }

    const originalStatus = version.status;
    if (originalStatus === TariffStatus.ACTIVE) {
      await this.assertActiveEditAllowed(dto);
    }

    if (dto.propertyType) {
      await this.assertValidUnitType(dto.propertyType);
    }

    const rateType = dto.rateType ?? version.rateType;
    const sortedTiers = rateType === TariffRateType.TIERED && dto.tiers
      ? this.assertTiersValid(dto.tiers)
      : undefined;

    const oldValue = { ...version };

    await this.dataSource.transaction(async (manager) => {
      const applicability = dto.applicability ?? version.applicability;

      Object.assign(version, {
        name: dto.name ?? version.name,
        propertyType: dto.propertyType ?? version.propertyType,
        rateType,
        applicability,
        flatRate: rateType === TariffRateType.FLAT ? dto.flatRate ?? version.flatRate : null,
        billingServiceFee: dto.billingServiceFee ?? version.billingServiceFee,
        activationFee: dto.activationFee ?? version.activationFee,
        securityDeposit: dto.securityDeposit ?? version.securityDeposit,
        latePaymentPenaltyType: dto.latePaymentPenaltyType ?? version.latePaymentPenaltyType,
        latePaymentPenalty: dto.latePaymentPenalty ?? version.latePaymentPenalty,
        disconnectionFee: dto.disconnectionFee ?? version.disconnectionFee,
        reconnectionFee: dto.reconnectionFee ?? version.reconnectionFee,
        tamperingPenalty: dto.tamperingPenalty ?? version.tamperingPenalty,
        bouncedChequeFee: dto.bouncedChequeFee ?? version.bouncedChequeFee,
        nocFee: dto.nocFee ?? version.nocFee,
        moveOutFee: dto.moveOutFee ?? version.moveOutFee,
        meterVerificationFee: dto.meterVerificationFee ?? version.meterVerificationFee,
        meterRentalEnabled: dto.meterRentalEnabled ?? version.meterRentalEnabled,
        meterRentalFee: dto.meterRentalFee ?? version.meterRentalFee,
        vat: dto.vat ?? version.vat,
        vatRegistrationNumber: dto.vatRegistrationNumber ?? version.vatRegistrationNumber,
        vatApplicableFees: dto.vatApplicableFees ?? version.vatApplicableFees,
        effectiveFrom: dto.effectiveFrom ?? version.effectiveFrom,
        effectiveTo: dto.effectiveTo ?? version.effectiveTo,
        description: dto.description ?? version.description,
      });

      if (applicability === TariffApplicability.PROPERTY && dto.propertyIds) {
        version.properties = await this.findPropertiesOrFail(manager, dto.propertyIds);
      } else if (applicability !== TariffApplicability.PROPERTY) {
        version.properties = [];
      }
      if (applicability === TariffApplicability.UNIT && dto.unitIds) {
        version.units = await this.findUnitsOrFail(manager, dto.unitIds);
      } else if (applicability !== TariffApplicability.UNIT) {
        version.units = [];
      }

      // PDF Scenario 3: a live tariff has no "no invoices generated yet"
      // signal to check without a Billing Engine, so every edit to an
      // active tariff is treated as that narrow, lower-stakes case — bump a
      // minor version and send it back to Finance rather than mutating a
      // record billing may already depend on without any review at all.
      // Locked fields (rate/scope/effectiveFrom) are already blocked above
      // by assertActiveEditAllowed, so only non-rate fields ever reach here.
      if (originalStatus === TariffStatus.ACTIVE) {
        version.version = nextMinorVersion(version.version);
        version.status = TariffStatus.PENDING;
        version.approvedBy = null;
        version.approvalDate = null;
        version.submittedOn = new Date().toISOString().slice(0, 10);
        if (actorId) version.submittedBy = { id: actorId } as any;
      }

      const saved = await manager.save(TariffVersion, version);

      if (sortedTiers) {
        await manager.delete(TariffTier, { version: { id } });
        const tierRows = sortedTiers.map((tier, index) =>
          manager.create(TariffTier, {
            version: saved,
            tierOrder: index + 1,
            minKwh: tier.minKwh,
            maxKwh: tier.maxKwh ?? null,
            ratePerKwh: tier.ratePerKwh,
          }),
        );
        await manager.save(TariffTier, tierRows);
      } else if (rateType === TariffRateType.FLAT) {
        await manager.delete(TariffTier, { version: { id } });
      }

      await this.audit(
        TariffAuditAction.UPDATE,
        id,
        oldValue,
        { ...saved, changeReason: dto.changeReason ?? null },
        actorId,
      );
    });

    return this.findOne(id);
  }

  // Business Admin action — moves a Draft, corrected, or rejected tariff
  // into the Finance approval queue. Distinct from create() so a tariff can
  // be saved and refined before ever entering the queue (PDF Scenario 1).
  async submit(id: number, actorId?: number) {
    const version = await this.versions.findOne({
      where: { id },
      relations: ['tiers', 'properties', 'units'],
    });
    if (!version) throw new NotFoundException('Tariff not found');
    if (!SUBMITTABLE_TARIFF_STATUSES.has(version.status)) {
      throw new BadRequestException('Only a draft, corrected, or rejected tariff can be submitted for approval');
    }

    const issues = this.getValidationIssues(version);
    if (issues.length) {
      throw new BadRequestException({
        message: 'This tariff is incomplete and cannot be submitted for approval yet.',
        issues,
      });
    }

    // Scope/date conflict is deliberately not enforced at create()/update()
    // time — a Draft may be freely edited even while a conflict exists with
    // another tariff. Submit is the point this tariff's scope becomes "real"
    // enough to actually compete for billing precedence, so it's checked
    // here instead — the same conflict check reactivate() already runs for
    // the identical reason. Covers both Submit and Resubmit for free, since
    // both call this same method.
    const conflict = await this.checkConflict({
      propertyType: version.propertyType,
      applicability: version.applicability,
      propertyIds: version.properties?.map((p) => p.id),
      unitIds: version.units?.map((u) => u.id),
      effectiveFrom: version.effectiveFrom ?? undefined,
      effectiveTo: version.effectiveTo ?? undefined,
      excludeId: version.id,
    } as TariffConflictQueryDto);
    if (conflict.status === 'exact-conflict') {
      throw new BadRequestException(
        `Cannot submit for approval — "${conflict.conflictingTariff?.name}" already covers this exact scope and date range.`,
      );
    }

    const oldValue = { ...version };
    version.status = TariffStatus.PENDING;
    version.submittedOn = new Date().toISOString().slice(0, 10);
    if (actorId) version.submittedBy = { id: actorId } as any;
    version.rejectionReason = null;
    version.rejectionNotes = null;
    const saved = await this.versions.save(version);

    await this.audit(TariffAuditAction.SUBMIT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  async approve(id: number, actorId?: number) {
    const version = await this.versions.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!version) throw new NotFoundException('Tariff not found');
    if (version.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be approved');
    }
    // Who may approve is entirely a Role Permissions decision
    // (TARIFF_APPROVE grant), enforced by PermissionGuard at the route —
    // no hardcoded role check here. assertNotSelfReview is a separate,
    // role-independent maker-checker rule and stays regardless of who holds
    // the grant.
    assertNotSelfReview(version.submittedBy?.id, actorId, 'approved');
    const oldValue = { ...version };
    version.status = TariffStatus.ACTIVE;
    if (actorId) version.approvedBy = { id: actorId } as any;
    version.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.versions.save(version);
    await this.audit(TariffAuditAction.APPROVE, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  async reject(id: number, dto: RejectTariffDto, actorId?: number) {
    const version = await this.versions.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!version) throw new NotFoundException('Tariff not found');
    if (version.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be rejected');
    }
    await this.assertValidRejectionReason(dto.rejectionReason);
    // Who may reject is entirely a Role Permissions decision
    // (TARIFF_REJECT grant), enforced by PermissionGuard at the route — no
    // hardcoded role check here. assertNotSelfReview is a separate,
    // role-independent maker-checker rule and stays regardless of who holds
    // the grant.
    assertNotSelfReview(version.submittedBy?.id, actorId, 'rejected');
    const oldValue = { ...version };
    version.status = TariffStatus.REJECTED;
    version.rejectionReason = dto.rejectionReason;
    version.rejectionNotes = dto.rejectionNotes;
    if (actorId) version.approvedBy = { id: actorId } as any;
    version.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.versions.save(version);
    await this.audit(TariffAuditAction.REJECT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  async deactivate(id: number, actorId?: number) {
    const version = await this.versions.findOne({ where: { id } });
    if (!version) throw new NotFoundException('Tariff not found');
    if (version.status !== TariffStatus.ACTIVE) {
      throw new BadRequestException('Only an active tariff can be deactivated — a pending one is locked until Finance approves or rejects it.');
    }
    const oldValue = { ...version };
    version.status = TariffStatus.INACTIVE;
    const saved = await this.versions.save(version);
    await this.audit(TariffAuditAction.DEACTIVATE, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // Business rule chosen for this gap (PDF doesn't specify one): reactivating
  // resumes a previously-approved tariff without a second Finance review,
  // but re-runs the same scope/date conflict check used at creation time, in
  // case another tariff has since taken its exact scope. Gated behind the
  // TARIFF_REACTIVATION_CONFLICT_CHECK module attribute so it can be relaxed
  // per deployment.
  async reactivate(id: number, actorId?: number) {
    const version = await this.versions.findOne({ where: { id }, relations: ['properties', 'units'] });
    if (!version) throw new NotFoundException('Tariff not found');
    if (version.status !== TariffStatus.INACTIVE) {
      throw new BadRequestException('Only inactive tariffs can be reactivated');
    }

    const conflictCheckEnabled = (await this.attributeService.getValueByKey('TARIFF_REACTIVATION_CONFLICT_CHECK')) !== 'false';
    if (conflictCheckEnabled) {
      const result = await this.checkConflict({
        propertyType: version.propertyType,
        applicability: version.applicability,
        propertyIds: version.properties?.map((p) => p.id),
        unitIds: version.units?.map((u) => u.id),
        effectiveFrom: version.effectiveFrom ?? undefined,
        effectiveTo: version.effectiveTo ?? undefined,
        excludeId: version.id,
      } as TariffConflictQueryDto);
      if (result.status === 'exact-conflict') {
        throw new BadRequestException(
          `Cannot reactivate — "${result.conflictingTariff?.name}" already covers this exact scope and date range.`,
        );
      }
    }

    const oldValue = { ...version };
    version.status = TariffStatus.ACTIVE;
    const saved = await this.versions.save(version);
    await this.audit(TariffAuditAction.REACTIVATE, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // Manual deprecation — PDF: "Manual deprecation by Super Admin". The
  // PDF's companion guard ("cannot deprecate if active billing cycle uses
  // it") is not enforced here since there is no Billing Engine to check
  // against yet.
  async deprecate(id: number, actorId?: number) {
    const version = await this.versions.findOne({ where: { id } });
    if (!version) throw new NotFoundException('Tariff not found');
    if (version.status !== TariffStatus.ACTIVE) {
      throw new BadRequestException('Only active tariffs can be deprecated');
    }
    const oldValue = { ...version };
    version.status = TariffStatus.DEPRECATED;
    const saved = await this.versions.save(version);
    await this.audit(TariffAuditAction.DEPRECATE, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // Scenario 5 — the only way to change a locked (ACTIVE_LOCKED_TARIFF_FIELDS)
  // field on an active tariff: clone it into a new editable Draft that
  // stays under the same master (so it shares the same business code) and
  // links back to its source via parentVersion.
  async newVersion(id: number, actorId?: number) {
    const source = await this.versions.findOne({
      where: { id },
      relations: ['tiers', 'properties', 'units'],
    });
    if (!source) throw new NotFoundException('Tariff not found');
    if (source.status !== TariffStatus.ACTIVE) {
      throw new BadRequestException('A new version can only be created from an active tariff');
    }

    const newId = await this.dataSource.transaction(async (manager) => {
      const clone = manager.create(TariffVersion, {
        masterId: source.masterId,
        name: source.name,
        status: TariffStatus.DRAFT,
        version: nextMajorVersion(source.version),
        parentVersion: { id: source.id } as TariffVersion,
        propertyType: source.propertyType,
        rateType: source.rateType,
        applicability: source.applicability,
        flatRate: source.flatRate,
        billingServiceFee: source.billingServiceFee,
        activationFee: source.activationFee,
        securityDeposit: source.securityDeposit,
        latePaymentPenaltyType: source.latePaymentPenaltyType,
        latePaymentPenalty: source.latePaymentPenalty,
        disconnectionFee: source.disconnectionFee,
        reconnectionFee: source.reconnectionFee,
        tamperingPenalty: source.tamperingPenalty,
        bouncedChequeFee: source.bouncedChequeFee,
        nocFee: source.nocFee,
        moveOutFee: source.moveOutFee,
        meterVerificationFee: source.meterVerificationFee,
        meterRentalEnabled: source.meterRentalEnabled,
        meterRentalFee: source.meterRentalFee,
        vat: source.vat,
        vatRegistrationNumber: source.vatRegistrationNumber,
        vatApplicableFees: source.vatApplicableFees,
        effectiveFrom: null,
        effectiveTo: source.effectiveTo,
        description: source.description,
        properties: source.properties,
        units: source.units,
      });

      const saved = await manager.save(TariffVersion, clone);

      if (source.rateType === TariffRateType.TIERED && source.tiers?.length) {
        const tierRows = source.tiers.map((tier) =>
          manager.create(TariffTier, {
            version: saved,
            tierOrder: tier.tierOrder,
            minKwh: tier.minKwh,
            maxKwh: tier.maxKwh,
            ratePerKwh: tier.ratePerKwh,
          }),
        );
        await manager.save(TariffTier, tierRows);
      }

      await this.audit(
        TariffAuditAction.CREATE_VERSION,
        saved.id,
        { sourceId: source.id, sourceVersion: source.version },
        saved,
        actorId,
      );

      return saved.id;
    });

    return this.findOne(newId);
  }

  private async audit(
    action: TariffAuditAction,
    entityId: number,
    oldValue: unknown,
    newValue: unknown,
    actorId?: number,
  ): Promise<void> {
    await this.auditService.record({
      moduleName: TARIFF_AUDIT_MODULE_NAME,
      entityId,
      action,
      oldValue,
      newValue,
      performedBy: actorId,
    });
  }

  // Field list is Business-Admin-configurable (Attributes > Tariff Config >
  // "Fields Requiring a New Version") so ops can add/relax locked fields
  // without a deploy — ACTIVE_LOCKED_TARIFF_FIELDS is only the fallback for
  // a missing/corrupt attribute value, not the source of truth.
  private async getActiveLockedFields(): Promise<(keyof UpdateTariffDto)[]> {
    const raw = await this.attributeService.getValueByKey('TARIFF_ACTIVE_LOCKED_FIELDS');
    if (!raw?.trim()) return ACTIVE_LOCKED_TARIFF_FIELDS;

    const fields = raw
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean) as (keyof UpdateTariffDto)[];

    return fields.length ? fields : ACTIVE_LOCKED_TARIFF_FIELDS;
  }

  private async assertActiveEditAllowed(dto: UpdateTariffDto) {
    const lockedFields = await this.getActiveLockedFields();
    const locked = lockedFields.filter((field) => dto[field] !== undefined);
    if (locked.length) {
      throw new BadRequestException(
        `Cannot change ${locked.join(', ')} on an active tariff — these require creating a new version first.`,
      );
    }
  }

  private async getDefaultVat(): Promise<number> {
    const value = await this.attributeService.getValueByKey('TARIFF_DEFAULT_VAT_RATE');
    const parsed = value !== null ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_VAT_RATE_FALLBACK;
  }

  private async findPropertiesOrFail(manager: EntityManager, propertyIds: number[]): Promise<Property[]> {
    const properties = await manager.findBy(Property, { id: In(propertyIds) });
    const foundIds = new Set(properties.map((p) => p.id));
    const missingIds = propertyIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      throw new BadRequestException(`Property not found: ${missingIds.join(', ')}`);
    }
    return properties;
  }

  private async findUnitsOrFail(manager: EntityManager, unitIds: number[]): Promise<Unit[]> {
    const units = await manager.findBy(Unit, { id: In(unitIds) });
    const foundIds = new Set(units.map((u) => u.id));
    const missingIds = unitIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      throw new BadRequestException(`Unit not found: ${missingIds.join(', ')}`);
    }
    return units;
  }

  // Single source of truth for "is this tariff complete enough to submit" —
  // a Draft is explicitly allowed to be missing any of this (PDF Scenario 1:
  // "a wizard creates it right after Step 1, before Step 2's rate values
  // exist"), but submit() must refuse to move it into the Finance queue
  // until every issue here is resolved. Returns every issue at once rather
  // than throwing on the first one, so the caller can show the user a
  // complete list in one pass instead of a fix-one-resubmit-repeat loop.
  // Field names match the frontend form's own field/state names exactly, so
  // the UI can highlight the right input directly off this list.
  // `counts` lets a caller that hasn't loaded the tiers/units relations
  // (findAll()'s list rows — see getRelationCounts) supply their existence
  // as plain numbers instead. Callers that DO have the relations loaded
  // (findOne(), submit()) simply omit it.
  private getValidationIssues(
    version: TariffVersion,
    counts?: { tierCount: number; unitCount: number },
  ): TariffValidationIssue[] {
    const issues: Array<{ field: string; message: string }> = [];
    const hasTiers = counts ? counts.tierCount > 0 : !!version.tiers?.length;
    const hasUnits = counts ? counts.unitCount > 0 : !!version.units?.length;

    // name is enforced at the DTO level (CreateTariffDto) too — checked
    // again here for any row that predates that change, and because this
    // is the one place that's supposed to know everything required to submit.
    if (!version.name?.trim()) {
      issues.push({ field: 'name', message: 'Tariff name is required.' });
    }

    if (!version.effectiveFrom) {
      issues.push({ field: 'effectiveFrom', message: 'Effective from date is required.' });
    }

    if (version.rateType === TariffRateType.FLAT) {
      if (version.flatRate === null || version.flatRate === undefined) {
        issues.push({ field: 'flatRate', message: 'A flat rate per kWh is required.' });
      }
    } else if (version.rateType === TariffRateType.TIERED) {
      if (!hasTiers) {
        issues.push({ field: 'tiers', message: 'At least one consumption tier is required.' });
      }
    }

    if (version.applicability === TariffApplicability.PROPERTY && !version.properties?.length) {
      issues.push({ field: 'propertyIds', message: 'At least one property must be selected.' });
    } else if (version.applicability === TariffApplicability.UNIT && !hasUnits) {
      issues.push({ field: 'unitIds', message: 'At least one unit must be selected.' });
    }

    // Not a DTO-level rule deliberately: vat defaults to 5 (non-zero) from
    // the very first create() call, before Step 3 — where the TRN field
    // lives — has ever been visited. Enforcing this unconditionally would
    // break the same Step-1-completion auto-save that flatRate/tiers'
    // deferred checks exist to support. Charging VAT without a registered
    // TRN isn't just incomplete, it's not legally chargeable, so this is
    // checked here rather than left as a soft recommendation.
    if (Number(version.vat) > 0 && !version.vatRegistrationNumber) {
      issues.push({ field: 'vatRegistrationNumber', message: 'A VAT registration number (TRN) is required when VAT is greater than 0%.' });
    }

    // Stamped from TARIFF_FIELD_METADATA here, in one place, rather than at
    // every push() above — adding a new check above never requires
    // touching a step number by hand, only that registry if it's a
    // genuinely new field.
    return issues.map((issue) => ({ ...issue, step: TARIFF_FIELD_METADATA[issue.field]?.step ?? 0 }));
  }

  private labelize(value: string) {
    return value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private formatUserName(user?: { firstName: string; lastName: string } | null): string | null {
    return user ? `${user.firstName} ${user.lastName}`.trim() : null;
  }

  private mapToResponse(
    version: TariffVersion,
    includeTiers = false,
    counts?: { tierCount: number; unitCount: number },
  ) {
    const validationIssues = this.getValidationIssues(version, counts);

    return {
      id: version.id,
      masterId: version.master?.id ?? null,
      code: version.master?.businessCode ?? null,
      name: version.name,
      status: version.status,
      version: version.version,
      parentTariffId: version.parentVersion?.id ?? null,
      propertyType: version.propertyType,
      rateType: version.rateType,
      applicability: version.applicability,
      flatRate: version.flatRate !== null && version.flatRate !== undefined ? Number(version.flatRate) : null,
      tiers: includeTiers
        ? (version.tiers ?? [])
            .sort((a, b) => a.tierOrder - b.tierOrder)
            .map((tier) => ({
              minKwh: Number(tier.minKwh),
              maxKwh: tier.maxKwh === null || tier.maxKwh === undefined ? null : Number(tier.maxKwh),
              ratePerKwh: Number(tier.ratePerKwh),
            }))
        : undefined,
      billingServiceFee: Number(version.billingServiceFee),
      activationFee: Number(version.activationFee),
      securityDeposit: Number(version.securityDeposit),
      latePaymentPenaltyType: version.latePaymentPenaltyType,
      latePaymentPenalty: Number(version.latePaymentPenalty),
      disconnectionFee: Number(version.disconnectionFee),
      reconnectionFee: Number(version.reconnectionFee),
      tamperingPenalty: Number(version.tamperingPenalty),
      bouncedChequeFee: Number(version.bouncedChequeFee),
      nocFee: Number(version.nocFee),
      moveOutFee: Number(version.moveOutFee),
      meterVerificationFee: Number(version.meterVerificationFee),
      meterRentalEnabled: version.meterRentalEnabled,
      meterRentalFee: Number(version.meterRentalFee),
      vat: Number(version.vat),
      vatRegistrationNumber: version.vatRegistrationNumber ?? null,
      vatApplicableFees: version.vatApplicableFees ?? [],
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      description: version.description,
      submittedBy: this.formatUserName(version.submittedBy),
      submittedById: version.submittedBy?.id ?? null,
      submittedOn: version.submittedOn,
      approvedBy: this.formatUserName(version.approvedBy),
      approvalDate: version.approvalDate,
      rejectionReason: version.rejectionReason,
      rejectionNotes: version.rejectionNotes,
      properties: (version.properties ?? []).map((property) => ({ id: property.id, name: property.name })),
      units: (version.units ?? []).map((unit) => ({ id: unit.id, unitNumber: unit.unitNumber })),
      isComplete: validationIssues.length === 0,
      validationIssues,
      // Single source of truth for "can this be edited / (re)submitted right
      // now" — both TariffList and the Tariff Detail page used to mirror
      // EDITABLE_TARIFF_STATUSES/SUBMITTABLE_TARIFF_STATUSES by hand as
      // hardcoded status-string comparisons; reading it from here instead
      // means the two can never drift from what update()/submit() will
      // actually accept.
      isEditable: EDITABLE_TARIFF_STATUSES.has(version.status),
      isSubmittable: SUBMITTABLE_TARIFF_STATUSES.has(version.status),
      createdAt: version.createdAt,
    };
  }
}

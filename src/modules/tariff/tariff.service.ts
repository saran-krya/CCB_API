import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AttributeService } from '../attribute/attribute.service';
import { AuditService } from '../../audit/audit.service';
import { ROLES } from '../../common/constants/global';
import { paginate } from '../../common/utils/pagination.util';
import { LovService } from '../lov/lov.service';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import {
  CreateTariffDto,
  RejectTariffDto,
  TariffConflictQueryDto,
  TariffQueryDto,
  UpdateTariffDto,
} from './dto/tariff.dto';
import { TariffTier } from './entities/tariff-tier.entity';
import {
  Tariff,
  TariffApplicability,
  TariffPenaltyType,
  TariffRateType,
  TariffStatus,
} from './entities/tariff.entity';
import {
  ACTIVE_LOCKED_TARIFF_FIELDS,
  DEFAULT_VAT_RATE_FALLBACK,
  EDITABLE_TARIFF_STATUSES,
  SORTABLE_TARIFF_FIELDS,
  SUBMITTABLE_TARIFF_STATUSES,
  TARIFF_AUDIT_MODULE_NAME,
  TARIFF_CODE_PAD_WIDTH,
  TARIFF_CODE_PREFIX,
  TARIFF_SORT_COLUMN_MAP,
  TARIFF_UNIT_TYPE_COMMERCIAL,
  TARIFF_UNIT_TYPE_LOV_CATEGORY,
  TARIFF_UNIT_TYPE_RESIDENTIAL,
  TariffAuditAction,
} from './tariff.constants';

@Injectable()
export class TariffService {
  constructor(
    @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
    @InjectRepository(Property) private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly attributeService: AttributeService,
    private readonly lovService: LovService,
  ) {}

  async checkConflict(query: TariffConflictQueryDto) {
    const qb = this.tariffs
      .createQueryBuilder('tariff')
      .leftJoinAndSelect('tariff.properties', 'properties')
      .leftJoinAndSelect('tariff.units', 'units')
      .where('tariff.propertyType = :propertyType', { propertyType: query.propertyType })
      .andWhere('tariff.status IN (:...statuses)', {
        statuses: [TariffStatus.ACTIVE, TariffStatus.PENDING, TariffStatus.REQUEST_FOR_CORRECTION],
      });

    if (query.excludeId) {
      qb.andWhere('tariff.id != :excludeId', { excludeId: query.excludeId });
    }
    if (query.effectiveFrom) {
      qb.andWhere('(tariff.effective_to IS NULL OR tariff.effective_to >= :from)', {
        from: query.effectiveFrom,
      });
    }
    if (query.effectiveTo) {
      qb.andWhere('(tariff.effective_from IS NULL OR tariff.effective_from <= :to)', {
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

    const isExactMatch = (t: Tariff): boolean => {
      if (t.applicability !== query.applicability) return false;
      if (t.applicability === TariffApplicability.GLOBAL) return true;
      if (t.applicability === TariffApplicability.PROPERTY) {
        const existingIds = new Set(t.properties.map((p) => p.id));
        return existingIds.size === queryPropertyIds.size && [...existingIds].every((id) => queryPropertyIds.has(id));
      }
      const existingIds = new Set(t.units.map((u) => u.id));
      return existingIds.size === queryUnitIds.size && [...existingIds].every((id) => queryUnitIds.has(id));
    };

    const isBroaderScope = (t: Tariff): boolean => {
      if (query.applicability === TariffApplicability.GLOBAL) return false;
      if (t.applicability === TariffApplicability.GLOBAL) return true;
      if (t.applicability === TariffApplicability.PROPERTY && query.applicability === TariffApplicability.UNIT) {
        return t.properties.some((p) => unitPropertyIds.has(p.id));
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

  private toConflictSummary(tariff: Tariff) {
    return { id: tariff.id, code: tariff.businessCode, name: tariff.name, applicability: tariff.applicability };
  }

  async getFilterMetadata() {
    const [properties, unitTypes] = await Promise.all([
      this.propertyRepo.find({
        relations: ['community'],
        order: { name: 'ASC' },
      }),
      this.lovService.findByCategory(TARIFF_UNIT_TYPE_LOV_CATEGORY),
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
    };
  }

  async getStats() {
    const [statusCounts, total] = await Promise.all([
      this.tariffs
        .createQueryBuilder('tariff')
        .select('tariff.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('tariff.status')
        .getRawMany<{ status: TariffStatus; count: string }>(),
      this.tariffs.count(),
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

    const rawBreakdown = await this.tariffs
      .createQueryBuilder('tariff')
      .select('tariff.applicability', 'applicability')
      .addSelect('tariff.property_type', 'propertyType')
      .addSelect('COUNT(*)', 'count')
      .where('tariff.status = :status', { status: TariffStatus.ACTIVE })
      .groupBy('tariff.applicability')
      .addGroupBy('tariff.property_type')
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
    const qb = this.tariffs
      .createQueryBuilder('tariff')
      .leftJoinAndSelect('tariff.submittedBy', 'submittedBy')
      .leftJoinAndSelect('tariff.approvedBy', 'approvedBy')
      .leftJoinAndSelect('tariff.properties', 'properties');

    if (query.search) {
      qb.andWhere('(tariff.name LIKE :search OR tariff.business_code LIKE :search)', {
        search: `%${query.search}%`,
      });
    }
    if (query.status) qb.andWhere('tariff.status = :status', { status: query.status });
    if (query.propertyType) {
      qb.andWhere('tariff.property_type = :propertyType', { propertyType: query.propertyType });
    }
    if (query.rateType) qb.andWhere('tariff.rate_type = :rateType', { rateType: query.rateType });
    if (query.applicability) {
      qb.andWhere('tariff.applicability = :applicability', { applicability: query.applicability });
    }

    const sortBy = query.sortBy && SORTABLE_TARIFF_FIELDS.has(query.sortBy) ? query.sortBy : 'createdAt';
    qb.orderBy(TARIFF_SORT_COLUMN_MAP[sortBy], query.sortOrder ?? 'DESC');

    const result = await paginate(qb, query);
    return {
      ...result,
      items: result.items.map((tariff) => this.mapToResponse(tariff)),
    };
  }

  async findOne(id: number) {
    const tariff = await this.tariffs.findOne({
      where: { id },
      relations: ['submittedBy', 'approvedBy', 'tiers', 'properties', 'properties.community', 'units', 'parentTariff'],
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    return this.mapToResponse(tariff, true);
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

  // Rate/scope shape is intentionally NOT validated here — a tariff can be
  // created as an incomplete draft (e.g. the wizard creates it right after
  // Step 1, before Step 2's rate values exist). submit() re-validates the
  // full persisted entity via validateRateShapeForEntity before it's allowed
  // into the approval queue, which is the point completeness actually matters.
  async create(dto: CreateTariffDto, actorId?: number) {
    await this.assertValidUnitType(dto.propertyType);

    const defaultVat = await this.getDefaultVat();

    const savedId = await this.dataSource.transaction(async (manager) => {
      const tariff = manager.create(Tariff, {
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
        tariff.properties = await this.findPropertiesOrFail(manager, dto.propertyIds);
      }
      if (dto.applicability === TariffApplicability.UNIT && dto.unitIds?.length) {
        tariff.units = await this.findUnitsOrFail(manager, dto.unitIds);
      }

      const saved = await manager.save(Tariff, tariff);
      saved.businessCode = `${TARIFF_CODE_PREFIX}${String(saved.id).padStart(TARIFF_CODE_PAD_WIDTH, '0')}`;
      await manager.update(Tariff, saved.id, { businessCode: saved.businessCode });

      if (dto.rateType === TariffRateType.TIERED && dto.tiers?.length) {
        const tierRows = dto.tiers.map((tier, index) =>
          manager.create(TariffTier, {
            tariff: saved,
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
    const tariff = await this.tariffs.findOne({
      where: { id },
      relations: ['tiers', 'properties', 'units'],
    });
    if (!tariff) throw new NotFoundException('Tariff not found');

    if (!EDITABLE_TARIFF_STATUSES.has(tariff.status)) {
      throw new BadRequestException(
        `A tariff with status "${this.labelize(tariff.status)}" is read-only and cannot be edited.`,
      );
    }

    if (tariff.status === TariffStatus.ACTIVE) {
      this.assertActiveEditAllowed(dto);
    }

    if (dto.propertyType) {
      await this.assertValidUnitType(dto.propertyType);
    }

    // Editing a Pending or Request-for-Correction tariff has no special
    // requirement or side effect — Business Admin can freely revise it while
    // Finance review is in progress (or after a correction request), and it
    // simply stays in whatever status it was already in.
    const oldValue = { ...tariff };

    await this.dataSource.transaction(async (manager) => {
      const rateType = dto.rateType ?? tariff.rateType;
      const applicability = dto.applicability ?? tariff.applicability;

      Object.assign(tariff, {
        name: dto.name ?? tariff.name,
        propertyType: dto.propertyType ?? tariff.propertyType,
        rateType,
        applicability,
        flatRate: rateType === TariffRateType.FLAT ? dto.flatRate ?? tariff.flatRate : null,
        billingServiceFee: dto.billingServiceFee ?? tariff.billingServiceFee,
        activationFee: dto.activationFee ?? tariff.activationFee,
        securityDeposit: dto.securityDeposit ?? tariff.securityDeposit,
        latePaymentPenaltyType: dto.latePaymentPenaltyType ?? tariff.latePaymentPenaltyType,
        latePaymentPenalty: dto.latePaymentPenalty ?? tariff.latePaymentPenalty,
        disconnectionFee: dto.disconnectionFee ?? tariff.disconnectionFee,
        reconnectionFee: dto.reconnectionFee ?? tariff.reconnectionFee,
        tamperingPenalty: dto.tamperingPenalty ?? tariff.tamperingPenalty,
        bouncedChequeFee: dto.bouncedChequeFee ?? tariff.bouncedChequeFee,
        nocFee: dto.nocFee ?? tariff.nocFee,
        moveOutFee: dto.moveOutFee ?? tariff.moveOutFee,
        meterVerificationFee: dto.meterVerificationFee ?? tariff.meterVerificationFee,
        meterRentalEnabled: dto.meterRentalEnabled ?? tariff.meterRentalEnabled,
        meterRentalFee: dto.meterRentalFee ?? tariff.meterRentalFee,
        vat: dto.vat ?? tariff.vat,
        vatRegistrationNumber: dto.vatRegistrationNumber ?? tariff.vatRegistrationNumber,
        vatApplicableFees: dto.vatApplicableFees ?? tariff.vatApplicableFees,
        effectiveFrom: dto.effectiveFrom ?? tariff.effectiveFrom,
        effectiveTo: dto.effectiveTo ?? tariff.effectiveTo,
        description: dto.description ?? tariff.description,
      });

      if (applicability === TariffApplicability.PROPERTY && dto.propertyIds) {
        tariff.properties = await this.findPropertiesOrFail(manager, dto.propertyIds);
      } else if (applicability !== TariffApplicability.PROPERTY) {
        tariff.properties = [];
      }
      if (applicability === TariffApplicability.UNIT && dto.unitIds) {
        tariff.units = await this.findUnitsOrFail(manager, dto.unitIds);
      } else if (applicability !== TariffApplicability.UNIT) {
        tariff.units = [];
      }

      const saved = await manager.save(Tariff, tariff);

      if (rateType === TariffRateType.TIERED && dto.tiers) {
        await manager.delete(TariffTier, { tariff: { id } });
        const tierRows = dto.tiers.map((tier, index) =>
          manager.create(TariffTier, {
            tariff: saved,
            tierOrder: index + 1,
            minKwh: tier.minKwh,
            maxKwh: tier.maxKwh ?? null,
            ratePerKwh: tier.ratePerKwh,
          }),
        );
        await manager.save(TariffTier, tierRows);
      } else if (rateType === TariffRateType.FLAT) {
        await manager.delete(TariffTier, { tariff: { id } });
      }

      await this.audit(TariffAuditAction.UPDATE, id, oldValue, { ...saved, changeReason: dto.changeReason ?? null }, actorId);
    });

    return this.findOne(id);
  }

  // Business Admin action — moves a Draft, corrected, or rejected tariff
  // into the Finance approval queue. Distinct from create() so a tariff can
  // be saved and refined before ever entering the queue (PDF Scenario 1).
  async submit(id: number, actorId?: number) {
    const tariff = await this.tariffs.findOne({
      where: { id },
      relations: ['tiers', 'properties', 'units'],
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (!SUBMITTABLE_TARIFF_STATUSES.has(tariff.status)) {
      throw new BadRequestException('Only a draft, corrected, or rejected tariff can be submitted for approval');
    }

    this.validateRateShapeForEntity(tariff);

    const oldValue = { ...tariff };
    tariff.status = TariffStatus.PENDING;
    tariff.submittedOn = new Date().toISOString().slice(0, 10);
    if (actorId) tariff.submittedBy = { id: actorId } as any;
    tariff.rejectionReason = null;
    tariff.rejectionNotes = null;
    const saved = await this.tariffs.save(tariff);

    await this.audit(TariffAuditAction.SUBMIT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  async approve(id: number, actorId?: number, actorRole?: string) {
    const tariff = await this.tariffs.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be approved');
    }
    this.assertOnlyFinanceMayReview(actorRole, 'approve');
    this.assertNotSelfReview(tariff, actorId, 'approved');
    const oldValue = { ...tariff };
    tariff.status = TariffStatus.ACTIVE;
    if (actorId) tariff.approvedBy = { id: actorId } as any;
    tariff.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.tariffs.save(tariff);
    await this.audit(TariffAuditAction.APPROVE, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  async reject(id: number, dto: RejectTariffDto, actorId?: number, actorRole?: string) {
    const tariff = await this.tariffs.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be rejected');
    }
    this.assertOnlyFinanceMayReview(actorRole, 'reject');
    this.assertNotSelfReview(tariff, actorId, 'rejected');
    const oldValue = { ...tariff };
    tariff.status = TariffStatus.REJECTED;
    tariff.rejectionReason = dto.rejectionReason;
    tariff.rejectionNotes = dto.rejectionNotes;
    if (actorId) tariff.approvedBy = { id: actorId } as any;
    tariff.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.tariffs.save(tariff);
    await this.audit(TariffAuditAction.REJECT, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  async deactivate(id: number, actorId?: number) {
    const tariff = await this.tariffs.findOne({ where: { id } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.ACTIVE && tariff.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only active or pending tariffs can be deactivated');
    }
    const oldValue = { ...tariff };
    tariff.status = TariffStatus.INACTIVE;
    const saved = await this.tariffs.save(tariff);
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
    const tariff = await this.tariffs.findOne({ where: { id }, relations: ['properties', 'units'] });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.INACTIVE) {
      throw new BadRequestException('Only inactive tariffs can be reactivated');
    }

    const conflictCheckEnabled = (await this.attributeService.getValueByKey('TARIFF_REACTIVATION_CONFLICT_CHECK')) !== 'false';
    if (conflictCheckEnabled) {
      const result = await this.checkConflict({
        propertyType: tariff.propertyType,
        applicability: tariff.applicability,
        propertyIds: tariff.properties?.map((p) => p.id),
        unitIds: tariff.units?.map((u) => u.id),
        effectiveFrom: tariff.effectiveFrom ?? undefined,
        effectiveTo: tariff.effectiveTo ?? undefined,
        excludeId: tariff.id,
      } as TariffConflictQueryDto);
      if (result.status === 'exact-conflict') {
        throw new BadRequestException(
          `Cannot reactivate — "${result.conflictingTariff?.name}" already covers this exact scope and date range.`,
        );
      }
    }

    const oldValue = { ...tariff };
    tariff.status = TariffStatus.ACTIVE;
    const saved = await this.tariffs.save(tariff);
    await this.audit(TariffAuditAction.REACTIVATE, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // Manual deprecation — PDF: "Manual deprecation by Super Admin". The
  // PDF's companion guard ("cannot deprecate if active billing cycle uses
  // it") is not enforced here since there is no Billing Engine to check
  // against yet.
  async deprecate(id: number, actorId?: number) {
    const tariff = await this.tariffs.findOne({ where: { id } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.ACTIVE) {
      throw new BadRequestException('Only active tariffs can be deprecated');
    }
    const oldValue = { ...tariff };
    tariff.status = TariffStatus.DEPRECATED;
    const saved = await this.tariffs.save(tariff);
    await this.audit(TariffAuditAction.DEPRECATE, id, oldValue, saved, actorId);
    return this.findOne(id);
  }

  // Scenario 5 — the only way to change a locked (ACTIVE_LOCKED_TARIFF_FIELDS)
  // field on an active tariff: clone it into a new editable Draft that
  // shares the same business code and links back via parentTariff.
  async newVersion(id: number, actorId?: number) {
    const source = await this.tariffs.findOne({
      where: { id },
      relations: ['tiers', 'properties', 'units'],
    });
    if (!source) throw new NotFoundException('Tariff not found');
    if (source.status !== TariffStatus.ACTIVE) {
      throw new BadRequestException('A new version can only be created from an active tariff');
    }

    const newId = await this.dataSource.transaction(async (manager) => {
      const clone = manager.create(Tariff, {
        businessCode: source.businessCode,
        name: source.name,
        status: TariffStatus.DRAFT,
        version: this.nextMajorVersion(source.version),
        parentTariff: { id: source.id } as Tariff,
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

      const saved = await manager.save(Tariff, clone);

      if (source.rateType === TariffRateType.TIERED && source.tiers?.length) {
        const tierRows = source.tiers.map((tier) =>
          manager.create(TariffTier, {
            tariff: saved,
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

  // Business rule (explicit, not derivable from the guard): approval belongs
  // ONLY to Finance. RolesGuard globally lets Super Admin bypass every
  // @Roles() check ("Full system access... Bypasses permission checks" —
  // see the FINANCE/SUPER_ADMIN seed descriptions), so @Roles(FINANCE) alone
  // on the controller is not enough to keep Super Admin out. This re-checks
  // the actor's role directly, inside the service, where nothing bypasses it.
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

  private assertOnlyFinanceMayReview(actorRole: string | undefined, action: 'approve' | 'reject') {
    if (actorRole !== ROLES.FINANCE) {
      throw new ForbiddenException(`Only the Finance role can ${action} a tariff — Super Admin and Admin are excluded by design.`);
    }
  }

  private assertNotSelfReview(tariff: Tariff, actorId: number | undefined, action: 'approved' | 'rejected') {
    if (actorId && tariff.submittedBy?.id === actorId) {
      throw new BadRequestException(
        `A tariff cannot be ${action} by the same user who submitted it. Ask another reviewer to action it.`,
      );
    }
  }

  private assertActiveEditAllowed(dto: UpdateTariffDto) {
    const locked = ACTIVE_LOCKED_TARIFF_FIELDS.filter((field) => dto[field] !== undefined);
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

  private nextMajorVersion(current: string): string {
    const major = parseInt(current.split('.')[0], 10);
    return `${Number.isFinite(major) ? major + 1 : 2}.0`;
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

  // Shared by validateRateShape (DTO, at create time) and
  // validateRateShapeForEntity (persisted entity, at submit time — that
  // endpoint has no request body to validate against).
  private assertRateShapeValid(shape: {
    rateType: TariffRateType;
    hasFlatRate: boolean;
    hasTiers: boolean;
    applicability: TariffApplicability;
    hasPropertyIds: boolean;
    hasUnitIds: boolean;
  }) {
    if (shape.rateType === TariffRateType.FLAT && !shape.hasFlatRate) {
      throw new BadRequestException('flatRate is required for flat-rate tariffs');
    }
    if (shape.rateType === TariffRateType.TIERED && !shape.hasTiers) {
      throw new BadRequestException('At least one tier is required for tiered tariffs');
    }
    if (shape.applicability === TariffApplicability.PROPERTY && !shape.hasPropertyIds) {
      throw new BadRequestException('At least one property is required for property-scoped tariffs');
    }
    if (shape.applicability === TariffApplicability.UNIT && !shape.hasUnitIds) {
      throw new BadRequestException('At least one unit is required for unit-scoped tariffs');
    }
  }

  private validateRateShapeForEntity(tariff: Tariff) {
    this.assertRateShapeValid({
      rateType: tariff.rateType,
      hasFlatRate: tariff.flatRate !== undefined && tariff.flatRate !== null,
      hasTiers: !!tariff.tiers?.length,
      applicability: tariff.applicability,
      hasPropertyIds: !!tariff.properties?.length,
      hasUnitIds: !!tariff.units?.length,
    });
  }

  private labelize(value: string) {
    return value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private mapToResponse(tariff: Tariff, includeTiers = false) {
    const name = (user?: { firstName: string; lastName: string } | null) =>
      user ? `${user.firstName} ${user.lastName}`.trim() : null;

    return {
      id: tariff.id,
      code: tariff.businessCode,
      name: tariff.name,
      status: tariff.status,
      version: tariff.version,
      parentTariffId: tariff.parentTariff?.id ?? null,
      propertyType: tariff.propertyType,
      rateType: tariff.rateType,
      applicability: tariff.applicability,
      flatRate: tariff.flatRate !== null && tariff.flatRate !== undefined ? Number(tariff.flatRate) : null,
      tiers: includeTiers
        ? (tariff.tiers ?? [])
            .sort((a, b) => a.tierOrder - b.tierOrder)
            .map((tier) => ({
              minKwh: Number(tier.minKwh),
              maxKwh: tier.maxKwh === null || tier.maxKwh === undefined ? null : Number(tier.maxKwh),
              ratePerKwh: Number(tier.ratePerKwh),
            }))
        : undefined,
      billingServiceFee: Number(tariff.billingServiceFee),
      activationFee: Number(tariff.activationFee),
      securityDeposit: Number(tariff.securityDeposit),
      latePaymentPenaltyType: tariff.latePaymentPenaltyType,
      latePaymentPenalty: Number(tariff.latePaymentPenalty),
      disconnectionFee: Number(tariff.disconnectionFee),
      reconnectionFee: Number(tariff.reconnectionFee),
      tamperingPenalty: Number(tariff.tamperingPenalty),
      bouncedChequeFee: Number(tariff.bouncedChequeFee),
      nocFee: Number(tariff.nocFee),
      moveOutFee: Number(tariff.moveOutFee),
      meterVerificationFee: Number(tariff.meterVerificationFee),
      meterRentalEnabled: tariff.meterRentalEnabled,
      meterRentalFee: Number(tariff.meterRentalFee),
      vat: Number(tariff.vat),
      vatRegistrationNumber: tariff.vatRegistrationNumber ?? null,
      vatApplicableFees: tariff.vatApplicableFees ?? [],
      effectiveFrom: tariff.effectiveFrom,
      effectiveTo: tariff.effectiveTo,
      description: tariff.description,
      submittedBy: name(tariff.submittedBy),
      submittedById: tariff.submittedBy?.id ?? null,
      submittedOn: tariff.submittedOn,
      approvedBy: name(tariff.approvedBy),
      approvalDate: tariff.approvalDate,
      rejectionReason: tariff.rejectionReason,
      rejectionNotes: tariff.rejectionNotes,
      properties: (tariff.properties ?? []).map((property) => ({ id: property.id, name: property.name })),
      units: (tariff.units ?? []).map((unit) => ({ id: unit.id, unitNumber: unit.unitNumber })),
      createdAt: tariff.createdAt,
    };
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
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
  TariffPropertyType,
  TariffRateType,
  TariffStatus,
} from './entities/tariff.entity';

const SORTABLE = new Set([
  'name',
  'businessCode',
  'status',
  'propertyType',
  'rateType',
  'applicability',
  'effectiveFrom',
  'createdAt',
]);

const SORT_COLUMN_MAP: Record<string, string> = {
  businessCode: 'tariff.businessCode',
  name: 'tariff.name',
  status: 'tariff.status',
  propertyType: 'tariff.propertyType',
  rateType: 'tariff.rateType',
  applicability: 'tariff.applicability',
  effectiveFrom: 'tariff.effectiveFrom',
  createdAt: 'tariff.createdAt',
};

@Injectable()
export class TariffService {
  constructor(
    @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
    @InjectRepository(Property) private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async checkConflict(query: TariffConflictQueryDto) {
    const qb = this.tariffs
      .createQueryBuilder('tariff')
      .leftJoinAndSelect('tariff.properties', 'properties')
      .leftJoinAndSelect('tariff.units', 'units')
      .where('tariff.propertyType = :propertyType', { propertyType: query.propertyType })
      .andWhere('tariff.status IN (:...statuses)', {
        statuses: [TariffStatus.ACTIVE, TariffStatus.PENDING],
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
    const properties = await this.propertyRepo.find({
      relations: ['community'],
      order: { name: 'ASC' },
    });

    return {
      statuses: Object.values(TariffStatus).map((value) => ({ value, label: this.labelize(value) })),
      propertyTypes: Object.values(TariffPropertyType).map((value) => ({ value, label: this.labelize(value) })),
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
    const [total, active, pending, inactive, rejected] = await Promise.all([
      this.tariffs.count(),
      this.tariffs.count({ where: { status: TariffStatus.ACTIVE } }),
      this.tariffs.count({ where: { status: TariffStatus.PENDING } }),
      this.tariffs.count({ where: { status: TariffStatus.INACTIVE } }),
      this.tariffs.count({ where: { status: TariffStatus.REJECTED } }),
    ]);

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
          if (entry.propertyType === TariffPropertyType.RESIDENTIAL) row.residential = Number(entry.count);
          if (entry.propertyType === TariffPropertyType.COMMERCIAL) row.commercial = Number(entry.count);
        });
      return row;
    });

    return {
      total,
      active,
      pending,
      inactive,
      rejected,
      statusDistribution: [
        { key: 'active', label: 'Active', value: active },
        { key: 'pending', label: 'Pending', value: pending },
        { key: 'inactive', label: 'Inactive', value: inactive },
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

    const sortBy = query.sortBy && SORTABLE.has(query.sortBy) ? query.sortBy : 'createdAt';
    qb.orderBy(SORT_COLUMN_MAP[sortBy], query.sortOrder ?? 'DESC');

    const result = await paginate(qb, query);
    return {
      ...result,
      items: result.items.map((tariff) => this.mapToResponse(tariff)),
    };
  }

  async findOne(id: number) {
    const tariff = await this.tariffs.findOne({
      where: { id },
      relations: ['submittedBy', 'approvedBy', 'tiers', 'properties', 'properties.community', 'units'],
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    return this.mapToResponse(tariff, true);
  }

  async create(dto: CreateTariffDto, actorId?: number) {
    this.validateRateShape(dto);

    const savedId = await this.dataSource.transaction(async (manager) => {
      const tariff = manager.create(Tariff, {
        name: dto.name,
        status: TariffStatus.PENDING,
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
        vat: dto.vat ?? 5,
        vatRegistrationNumber: dto.vatRegistrationNumber ?? null,
        vatApplicableFees: dto.vatApplicableFees ?? null,
        effectiveFrom: dto.effectiveFrom ?? null,
        effectiveTo: dto.effectiveTo ?? null,
        description: dto.description ?? null,
        submittedOn: new Date().toISOString().slice(0, 10),
      });
      if (actorId) tariff.submittedBy = { id: actorId } as any;

      if (dto.applicability === TariffApplicability.PROPERTY && dto.propertyIds?.length) {
        tariff.properties = await this.findPropertiesOrFail(manager, dto.propertyIds);
      }
      if (dto.applicability === TariffApplicability.UNIT && dto.unitIds?.length) {
        tariff.units = await this.findUnitsOrFail(manager, dto.unitIds);
      }

      const saved = await manager.save(Tariff, tariff);
      saved.businessCode = `TAR-${String(saved.id).padStart(6, '0')}`;
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

      await this.auditService.record({
        moduleName: 'Tariff',
        entityId: saved.id,
        action: 'CREATE',
        oldValue: null,
        newValue: saved,
        performedBy: actorId,
      });

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
    if (tariff.status !== TariffStatus.PENDING && tariff.status !== TariffStatus.INACTIVE) {
      throw new BadRequestException('Only pending or inactive tariffs can be edited');
    }

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

      await this.auditService.record({
        moduleName: 'Tariff',
        entityId: id,
        action: 'UPDATE',
        oldValue,
        newValue: saved,
        performedBy: actorId,
      });
    });

    return this.findOne(id);
  }

  async approve(id: number, actorId?: number) {
    const tariff = await this.tariffs.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be approved');
    }
    this.assertNotSelfReview(tariff, actorId, 'approved');
    const oldValue = { ...tariff };
    tariff.status = TariffStatus.ACTIVE;
    if (actorId) tariff.approvedBy = { id: actorId } as any;
    tariff.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.tariffs.save(tariff);
    await this.auditService.record({
      moduleName: 'Tariff',
      entityId: id,
      action: 'APPROVE',
      oldValue,
      newValue: saved,
      performedBy: actorId,
    });
    return this.findOne(id);
  }

  async reject(id: number, dto: RejectTariffDto, actorId?: number) {
    const tariff = await this.tariffs.findOne({ where: { id }, relations: ['submittedBy'] });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be rejected');
    }
    this.assertNotSelfReview(tariff, actorId, 'rejected');
    const oldValue = { ...tariff };
    tariff.status = TariffStatus.REJECTED;
    tariff.rejectionReason = dto.rejectionReason;
    tariff.rejectionNotes = dto.rejectionNotes;
    if (actorId) tariff.approvedBy = { id: actorId } as any;
    tariff.approvalDate = new Date().toISOString().slice(0, 10);
    const saved = await this.tariffs.save(tariff);
    await this.auditService.record({
      moduleName: 'Tariff',
      entityId: id,
      action: 'REJECT',
      oldValue,
      newValue: saved,
      performedBy: actorId,
    });
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
    await this.auditService.record({
      moduleName: 'Tariff',
      entityId: id,
      action: 'DEACTIVATE',
      oldValue,
      newValue: saved,
      performedBy: actorId,
    });
    return this.findOne(id);
  }

  private assertNotSelfReview(tariff: Tariff, actorId: number | undefined, action: 'approved' | 'rejected') {
    if (actorId && tariff.submittedBy?.id === actorId) {
      throw new BadRequestException(
        `A tariff cannot be ${action} by the same user who submitted it. Ask another reviewer to action it.`,
      );
    }
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

  private validateRateShape(dto: CreateTariffDto) {
    if (dto.rateType === TariffRateType.FLAT && (dto.flatRate === undefined || dto.flatRate === null)) {
      throw new BadRequestException('flatRate is required for flat-rate tariffs');
    }
    if (dto.rateType === TariffRateType.TIERED && (!dto.tiers || dto.tiers.length === 0)) {
      throw new BadRequestException('At least one tier is required for tiered tariffs');
    }
    if (dto.applicability === TariffApplicability.PROPERTY && (!dto.propertyIds || dto.propertyIds.length === 0)) {
      throw new BadRequestException('At least one property is required for property-scoped tariffs');
    }
    if (dto.applicability === TariffApplicability.UNIT && (!dto.unitIds || dto.unitIds.length === 0)) {
      throw new BadRequestException('At least one unit is required for unit-scoped tariffs');
    }
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

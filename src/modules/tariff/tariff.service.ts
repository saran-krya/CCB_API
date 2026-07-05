import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { CreateTariffDto, RejectTariffDto, TariffQueryDto, UpdateTariffDto } from './dto/tariff.dto';
import { TariffTier } from './entities/tariff-tier.entity';
import {
  Tariff,
  TariffApplicability,
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
  businessCode: 'tariff.business_code',
  name: 'tariff.name',
  status: 'tariff.status',
  propertyType: 'tariff.property_type',
  rateType: 'tariff.rate_type',
  applicability: 'tariff.applicability',
  effectiveFrom: 'tariff.effective_from',
  createdAt: 'tariff.created_at',
};

@Injectable()
export class TariffService {
  constructor(
    @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
    @InjectRepository(Property) private readonly propertyRepo: Repository<Property>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

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

    return this.dataSource.transaction(async (manager) => {
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
        latePaymentPenalty: dto.latePaymentPenalty ?? 0,
        disconnectionFee: dto.disconnectionFee ?? 0,
        reconnectionFee: dto.reconnectionFee ?? 0,
        tamperingPenalty: dto.tamperingPenalty ?? 0,
        nocFee: dto.nocFee ?? 0,
        moveOutFee: dto.moveOutFee ?? 0,
        vat: dto.vat ?? 5,
        effectiveFrom: dto.effectiveFrom ?? null,
        effectiveTo: dto.effectiveTo ?? null,
        description: dto.description ?? null,
        submittedOn: new Date().toISOString().slice(0, 10),
      });
      if (actorId) tariff.submittedBy = { id: actorId } as any;

      if (dto.applicability === TariffApplicability.PROPERTY && dto.propertyIds?.length) {
        tariff.properties = await manager.findBy(Property, { id: In(dto.propertyIds) });
      }
      if (dto.applicability === TariffApplicability.UNIT && dto.unitIds?.length) {
        tariff.units = await manager.findBy(Unit, { id: In(dto.unitIds) });
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

      return this.findOne(saved.id);
    });
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

    return this.dataSource.transaction(async (manager) => {
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
        latePaymentPenalty: dto.latePaymentPenalty ?? tariff.latePaymentPenalty,
        disconnectionFee: dto.disconnectionFee ?? tariff.disconnectionFee,
        reconnectionFee: dto.reconnectionFee ?? tariff.reconnectionFee,
        tamperingPenalty: dto.tamperingPenalty ?? tariff.tamperingPenalty,
        nocFee: dto.nocFee ?? tariff.nocFee,
        moveOutFee: dto.moveOutFee ?? tariff.moveOutFee,
        vat: dto.vat ?? tariff.vat,
        effectiveFrom: dto.effectiveFrom ?? tariff.effectiveFrom,
        effectiveTo: dto.effectiveTo ?? tariff.effectiveTo,
        description: dto.description ?? tariff.description,
      });

      if (applicability === TariffApplicability.PROPERTY && dto.propertyIds) {
        tariff.properties = await manager.findBy(Property, { id: In(dto.propertyIds) });
      } else if (applicability !== TariffApplicability.PROPERTY) {
        tariff.properties = [];
      }
      if (applicability === TariffApplicability.UNIT && dto.unitIds) {
        tariff.units = await manager.findBy(Unit, { id: In(dto.unitIds) });
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

      return this.findOne(id);
    });
  }

  async approve(id: number, actorId?: number) {
    const tariff = await this.tariffs.findOne({ where: { id } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be approved');
    }
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
    const tariff = await this.tariffs.findOne({ where: { id } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.status !== TariffStatus.PENDING) {
      throw new BadRequestException('Only pending tariffs can be rejected');
    }
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
      latePaymentPenalty: Number(tariff.latePaymentPenalty),
      disconnectionFee: Number(tariff.disconnectionFee),
      reconnectionFee: Number(tariff.reconnectionFee),
      tamperingPenalty: Number(tariff.tamperingPenalty),
      nocFee: Number(tariff.nocFee),
      moveOutFee: Number(tariff.moveOutFee),
      vat: Number(tariff.vat),
      effectiveFrom: tariff.effectiveFrom,
      effectiveTo: tariff.effectiveTo,
      description: tariff.description,
      submittedBy: name(tariff.submittedBy),
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

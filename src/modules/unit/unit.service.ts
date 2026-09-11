import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { PropertyService } from '../property/property.service';
import { CustomerService } from '../customer/customer.service';
import {
  CreateUnitDto,
  UnitQueryDto,
  UpdateOccupancyDto,
  UpdateUnitDto,
} from './dto/create-unit.dto';
import { UnitDetailDto, UnitListDto } from './dto/unit-response.dto';
import { OccupancyStatus, Unit, UnitStatus } from './entities/unit.entity';
import { MyMeterDetailDto } from '../meter/dto/my-meter-detail.dto';

@Injectable()
export class UnitService {
  constructor(
    @InjectRepository(Unit)
    private readonly units: Repository<Unit>,
    private readonly properties: PropertyService,
    @Inject(forwardRef(() => CustomerService))
    private readonly customers: CustomerService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateUnitDto, actorId?: number) {
    const property = await this.properties.findOneEntity(dto.propertyId);

    const existing = await this.units.findOne({
      where: { unitNumber: dto.unitNumber, property: { id: dto.propertyId } },
    });
    if (existing) {
      throw new ConflictException('Unit number already exists in this property');
    }

    return this.dataSource.transaction(async (manager) => {
      const unit = manager.create(Unit, {
        ...dto,
        property,
        occupancyStatus: dto.occupancyStatus ?? OccupancyStatus.VACANT,
        status: dto.status ?? UnitStatus.ACTIVE,
        balcony: dto.balcony ?? false,
        parkingSpaces: dto.parkingSpaces ?? 0,
      });
      const saved = await manager.save(Unit, unit);
      saved.businessCode = `UNT-${String(saved.id).padStart(6, '0')}`;
      await manager.save(Unit, saved);

      await this.audit.record({
        moduleName: 'units',
        entityId: saved.id,
        action: 'CREATE',
        newValue: {
          unitNumber: saved.unitNumber,
          floorNumber: saved.floorNumber,
          unitType: saved.unitType,
          occupancyStatus: saved.occupancyStatus,
          status: saved.status,
          propertyId: saved.property?.id,
        },
        performedBy: actorId,
      });

      return saved;
    });
  }

  async findAll(query: UnitQueryDto) {
    const { propertyId, communityId, unitType, occupancyStatus, status, search, sortBy, sortOrder } = query;

    const qb = this.units
      .createQueryBuilder('u')
      .select(['u.id', 'u.unitNumber', 'u.businessCode', 'u.floorNumber', 'u.unitType', 'u.unitSize', 'u.occupancyStatus', 'u.status', 'u.createdAt'])
      .leftJoin('u.property', 'property')
      .addSelect(['property.id', 'property.name'])
      .leftJoin('property.community', 'community')
      .addSelect(['community.id', 'community.name'])
      .orderBy(`u.${sortBy ?? 'createdAt'}`, sortOrder ?? 'DESC');

    if (search) {
      qb.andWhere('(u.unitNumber LIKE :s OR u.businessCode LIKE :s OR u.ownerId LIKE :s OR u.tenantId LIKE :s)', {
        s: `%${search}%`,
      });
    }
    if (propertyId) qb.andWhere('u.property = :propertyId', { propertyId });
    if (communityId) qb.andWhere('property.community = :communityId', { communityId });
    if (unitType) qb.andWhere('u.unitType = :unitType', { unitType });
    if (occupancyStatus) qb.andWhere('u.occupancyStatus = :occupancyStatus', { occupancyStatus });
    if (status) qb.andWhere('u.status = :status', { status });

    const result = await paginate(qb, query);
    const items: UnitListDto[] = result.items.map((u: any) => ({
      id: u.id,
      unitNumber: u.unitNumber,
      businessCode: u.businessCode ?? null,
      floorNumber: u.floorNumber,
      unitType: u.unitType,
      unitSize: u.unitSize != null ? Number(u.unitSize) : null,
      occupancyStatus: u.occupancyStatus,
      status: u.status,
      createdDate: (u.createdAt as Date)?.toISOString() ?? '',
      propertyId: u.property?.id,
      propertyName: u.property?.name,
      communityId: u.property?.community?.id,
      communityName: u.property?.community?.name,
    }));
    return { items, pagination: result.pagination };
  }

  async findOne(id: number): Promise<UnitDetailDto> {
    const unit = await this.units.findOne({
      where: { id },
      relations: { property: { community: true }, subMeter: { masterMeter: true } },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    // Composed here (not left to a separate GET /customers call from the caller) specifically so
    // the Communities feature's own unit drill-through page never needs VIEW_CUSTOMER at all — see
    // CustomerService.findByUnitId's own doc comment for the full reasoning.
    const customers = await this.customers.findByUnitId(id);
    return {
      id: unit.id,
      unitNumber: unit.unitNumber,
      businessCode: unit.businessCode ?? null,
      floorNumber: unit.floorNumber,
      unitType: unit.unitType,
      unitSize: unit.unitSize != null ? Number(unit.unitSize) : null,
      occupancyStatus: unit.occupancyStatus,
      status: unit.status,
      bedrooms: unit.bedrooms ?? null,
      bathrooms: unit.bathrooms ?? null,
      balcony: unit.balcony,
      parkingSpaces: unit.parkingSpaces,
      monthlyRent: unit.monthlyRent != null ? Number(unit.monthlyRent) : null,
      handoverDate: unit.handoverDate ?? null,
      ownerId: unit.ownerId ?? null,
      tenantId: unit.tenantId ?? null,
      subMeterId: unit.subMeter?.id ?? null,
      subMeterCode: unit.subMeter?.businessCode ?? null,
      masterMeterId: unit.subMeter?.masterMeter?.id ?? null,
      masterMeterCode: unit.subMeter?.masterMeter?.businessCode ?? null,
      amenities: unit.amenities ?? null,
      description: unit.description ?? null,
      createdDate: unit.createdAt?.toISOString() ?? '',
      propertyId: unit.property.id,
      propertyName: unit.property.name,
      propertyCode: unit.property.code,
      communityId: unit.property.community.id,
      communityName: unit.property.community.name,
      customers,
    };
  }

  /**
   * The "Meter Details" shape a Customer actually needs — deliberately NOT UnitDetailDto (which
   * only carries meter id/code pairs for the Portfolio/Profile pages). Same query shape as findOne
   * (subMeter.masterMeter is already a real, always-loadable relation — see SubMeter/MasterMeter's
   * own doc comments), just returning the meter's own fields instead of unit fields. Master Meter
   * stays minimal (code + status only) — it has no unit relation of its own, so nothing beyond "the
   * meter upstream of yours, and whether it's active" is genuinely useful here.
   */
  async findMeterDetail(unitId: number): Promise<MyMeterDetailDto> {
    const unit = await this.units.findOne({
      where: { id: unitId },
      relations: { subMeter: { masterMeter: true } },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    return {
      unitId: unit.id,
      unitNumber: unit.unitNumber,
      subMeter: unit.subMeter
        ? {
            id: unit.subMeter.id,
            businessCode: unit.subMeter.businessCode ?? null,
            status: unit.subMeter.status,
            floor: unit.subMeter.floor ?? null,
            meterMake: unit.subMeter.meterMake ?? null,
            meterModel: unit.subMeter.meterModel ?? null,
            installationDate: unit.subMeter.installationDate ?? null,
          }
        : null,
      masterMeter: unit.subMeter?.masterMeter
        ? {
            id: unit.subMeter.masterMeter.id,
            businessCode: unit.subMeter.masterMeter.businessCode ?? null,
            status: unit.subMeter.masterMeter.status,
          }
        : null,
    };
  }

  /**
   * Display-label lookup only — never a substitute for the point-in-time propertyId/communityId
   * snapshot RegistrationRequestUnit stores (see that entity's own doc comment on why it holds no
   * live relation). This just resolves current unit/property/community NAMES for showing a
   * human-readable label; unresolvable ids (a unit since deleted) are simply absent from the map,
   * never guessed or defaulted.
   */
  async findLabelsByIds(unitIds: number[]): Promise<Record<number, { unitNumber: string; propertyName: string; communityName: string }>> {
    const result: Record<number, { unitNumber: string; propertyName: string; communityName: string }> = {};
    if (!unitIds.length) return result;

    const units = await this.units.find({
      where: { id: In([...new Set(unitIds)]) },
      relations: { property: { community: true } },
    });
    for (const u of units) {
      result[u.id] = {
        unitNumber: u.unitNumber,
        propertyName: u.property?.name ?? '',
        communityName: u.property?.community?.name ?? '',
      };
    }
    return result;
  }

  async update(id: number, dto: UpdateUnitDto, actorId?: number) {
    const unit = await this.units.findOne({
      where: { id },
      relations: { property: true },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    if (dto.propertyId && dto.propertyId !== unit.property?.id) {
      unit.property = await this.properties.findOneEntity(dto.propertyId);
    }

    const targetPropertyId = dto.propertyId ?? unit.property?.id;

    if (dto.unitNumber && dto.unitNumber !== unit.unitNumber) {
      const exists = await this.units.findOne({
        where: { unitNumber: dto.unitNumber, property: { id: targetPropertyId } },
      });
      if (exists && exists.id !== id) {
        throw new ConflictException('Unit number already exists in this property');
      }
    }

    const oldValue = {
      unitNumber: unit.unitNumber,
      floorNumber: unit.floorNumber,
      unitType: unit.unitType,
      occupancyStatus: unit.occupancyStatus,
      status: unit.status,
    };

    Object.assign(unit, dto);
    const saved = await this.units.save(unit);

    await this.audit.record({
      moduleName: 'units',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: {
        unitNumber: saved.unitNumber,
        floorNumber: saved.floorNumber,
        unitType: saved.unitType,
        occupancyStatus: saved.occupancyStatus,
        status: saved.status,
      },
      performedBy: actorId,
    });

    return saved;
  }

  async updateOccupancy(id: number, dto: UpdateOccupancyDto, actorId?: number) {
    const unit = await this.units.findOne({ where: { id } });
    if (!unit) throw new NotFoundException('Unit not found');

    const oldOccupancy = unit.occupancyStatus;
    unit.occupancyStatus = dto.occupancyStatus;
    const saved = await this.units.save(unit);

    await this.audit.record({
      moduleName: 'units',
      entityId: id,
      action: 'UPDATE',
      oldValue: { occupancyStatus: oldOccupancy },
      newValue: { occupancyStatus: saved.occupancyStatus },
      performedBy: actorId,
    });

    return saved;
  }

  async findOneEntity(id: number): Promise<Unit> {
    const unit = await this.units.findOne({ where: { id } });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async remove(id: number, actorId?: number) {
    const unit = await this.units.findOne({ where: { id } });
    if (!unit) throw new NotFoundException('Unit not found');

    await this.units.softRemove(unit);

    await this.audit.record({
      moduleName: 'units',
      entityId: id,
      action: 'DELETE',
      oldValue: {
        unitNumber: unit.unitNumber,
        unitType: unit.unitType,
        occupancyStatus: unit.occupancyStatus,
        status: unit.status,
      },
      performedBy: actorId,
    });

    return { deleted: true };
  }
}

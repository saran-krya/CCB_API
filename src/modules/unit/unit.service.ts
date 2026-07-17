import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { PropertyService } from '../property/property.service';
import {
  CreateUnitDto,
  UnitQueryDto,
  UpdateOccupancyDto,
  UpdateUnitDto,
} from './dto/create-unit.dto';
import { UnitDetailDto, UnitListDto } from './dto/unit-response.dto';
import { OccupancyStatus, Unit, UnitStatus } from './entities/unit.entity';

@Injectable()
export class UnitService {
  constructor(
    @InjectRepository(Unit)
    private readonly units: Repository<Unit>,
    private readonly properties: PropertyService,
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
      // Sourced from the real SubMeter.unit / SubMeter.masterMeter relations
      // (see unit.entity.ts's Unit.subMeter comment) — never a denormalized
      // copy, so this can never drift from the actual mapping.
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
    };
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

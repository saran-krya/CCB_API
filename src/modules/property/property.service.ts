import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { CommunityService } from '../community/community.service';
import { Unit } from '../unit/entities/unit.entity';
import {
  CreatePropertyDto,
  PropertyQueryDto,
  UpdatePropertyDto,
  UpdatePropertyStatusDto,
} from './dto/create-property.dto';
import { PropertyDetailDto, PropertyListDto } from './dto/property-response.dto';
import { Property, PropertyStatus, PropertyType } from './entities/property.entity';

@Injectable()
export class PropertyService {
  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    @InjectRepository(Unit)
    private readonly units: Repository<Unit>,
    private readonly communities: CommunityService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreatePropertyDto, actorId?: number) {
    const existing = await this.properties.findOne({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Property code already exists');

    const community = await this.communities.findOneEntity(dto.communityId);

    return this.dataSource.transaction(async (manager) => {
      const property = manager.create(Property, {
        ...dto,
        community,
        propertyType: dto.propertyType ?? PropertyType.RESIDENTIAL,
        numberOfFloors: dto.numberOfFloors ?? 1,
        status: dto.status ?? PropertyStatus.ACTIVE,
      });
      const saved = await manager.save(Property, property);
      saved.businessCode = `PRP-${String(saved.id).padStart(6, '0')}`;
      await manager.save(Property, saved);

      await this.audit.record({
        moduleName: 'properties',
        entityId: saved.id,
        action: 'CREATE',
        newValue: { name: saved.name, code: saved.code, status: saved.status, communityId: saved.community?.id },
        performedBy: actorId,
      });

      return saved;
    });
  }

  async findAll(query: PropertyQueryDto) {
    const { communityId, propertyType, status, search, sortBy, sortOrder } = query;

    const qb = this.properties
      .createQueryBuilder('p')
      .select(['p.id', 'p.name', 'p.code', 'p.businessCode', 'p.propertyType', 'p.numberOfFloors', 'p.status', 'p.createdAt'])
      .leftJoin('p.community', 'community')
      .addSelect(['community.id', 'community.name'])
      .loadRelationCountAndMap('p.totalUnits', 'p.units', 'u', (sub) =>
        sub.where('u.deleted_at IS NULL'),
      )
      .orderBy(`p.${sortBy ?? 'createdAt'}`, sortOrder ?? 'DESC');

    if (search) {
      qb.andWhere('(p.name LIKE :s OR p.code LIKE :s OR p.businessCode LIKE :s OR p.location LIKE :s)', {
        s: `%${search}%`,
      });
    }
    if (communityId) qb.andWhere('p.community = :communityId', { communityId });
    if (propertyType) qb.andWhere('p.propertyType = :propertyType', { propertyType });
    if (status) qb.andWhere('p.status = :status', { status });

    const result = await paginate(qb, query);
    const items: PropertyListDto[] = result.items.map((p: any) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      businessCode: p.businessCode ?? null,
      propertyType: p.propertyType,
      numberOfFloors: p.numberOfFloors,
      totalUnits: p.totalUnits ?? 0,
      status: p.status,
      createdDate: (p.createdAt as Date)?.toISOString() ?? '',
      communityId: p.community?.id,
      communityName: p.community?.name,
    }));
    return { items, pagination: result.pagination };
  }

  async findOne(id: number): Promise<PropertyDetailDto> {
    const property = await this.properties.findOne({
      where: { id },
      relations: { community: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    const [units, statsRows] = await Promise.all([
      this.units.find({
        where: { property: { id } },
        select: {
          id: true, unitNumber: true, floorNumber: true, unitType: true,
          unitSize: true, occupancyStatus: true, status: true,
          bedrooms: true, bathrooms: true, monthlyRent: true,
        },
        order: { floorNumber: 'ASC', unitNumber: 'ASC' },
      }),
      this.dataSource.query<any[]>(
        `
        SELECT
          COUNT(*)                                                                AS totalUnits,
          SUM(CASE WHEN unit_type IN ('apartment','studio') THEN 1 ELSE 0 END)   AS residentialUnits,
          SUM(CASE WHEN unit_type IN ('office','shop','garage') THEN 1 ELSE 0 END) AS commercialUnits,
          SUM(CASE WHEN occupancy_status = 'occupied' THEN 1 ELSE 0 END)         AS occupiedUnits,
          SUM(CASE WHEN occupancy_status = 'vacant'   THEN 1 ELSE 0 END)         AS vacantUnits
        FROM units
        WHERE property_id = ? AND deleted_at IS NULL
      `,
        [id],
      ),
    ]);

    const row = statsRows[0] ?? {};
    return {
      id: property.id,
      name: property.name,
      code: property.code,
      businessCode: property.businessCode ?? null,
      propertyType: property.propertyType,
      numberOfFloors: property.numberOfFloors,
      status: property.status,
      description: property.description ?? null,
      location: property.location ?? null,
      address: property.address ?? null,
      city: property.city ?? null,
      state: property.state ?? null,
      zipCode: property.zipCode ?? null,
      country: property.country ?? null,
      contactPerson: property.contactPerson ?? null,
      contactEmail: property.contactEmail ?? null,
      contactPhone: property.contactPhone ?? null,
      createdDate: property.createdAt?.toISOString() ?? '',
      communityId: property.community.id,
      communityName: property.community.name,
      totalUnits: Number(row.totalUnits ?? 0),
      residentialUnits: Number(row.residentialUnits ?? 0),
      commercialUnits: Number(row.commercialUnits ?? 0),
      occupiedUnits: Number(row.occupiedUnits ?? 0),
      vacantUnits: Number(row.vacantUnits ?? 0),
      totalSubMeters: 0,
      mappedMeters: 0,
      unmappedMeters: 0,
      units: units.map((u) => ({
        id: u.id,
        unitNumber: u.unitNumber,
        floorNumber: u.floorNumber,
        unitType: u.unitType,
        unitSize: u.unitSize != null ? Number(u.unitSize) : null,
        occupancyStatus: u.occupancyStatus,
        status: u.status,
        bedrooms: u.bedrooms ?? null,
        bathrooms: u.bathrooms ?? null,
        monthlyRent: u.monthlyRent != null ? Number(u.monthlyRent) : null,
      })),
    };
  }

  async update(id: number, dto: UpdatePropertyDto, actorId?: number) {
    const property = await this.properties.findOne({
      where: { id },
      relations: { community: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    if (dto.code && dto.code !== property.code) {
      const exists = await this.properties.findOne({ where: { code: dto.code } });
      if (exists) throw new ConflictException('Property code already exists');
    }

    if (dto.communityId && dto.communityId !== property.community?.id) {
      property.community = await this.communities.findOneEntity(dto.communityId);
    }

    const oldValue = { name: property.name, code: property.code, status: property.status };
    Object.assign(property, dto);
    const saved = await this.properties.save(property);

    await this.audit.record({
      moduleName: 'properties',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: { name: saved.name, code: saved.code, status: saved.status },
      performedBy: actorId,
    });

    return saved;
  }

  async updateStatus(id: number, dto: UpdatePropertyStatusDto, actorId?: number) {
    const property = await this.properties.findOne({ where: { id } });
    if (!property) throw new NotFoundException('Property not found');

    const oldStatus = property.status;
    property.status = dto.status;
    const saved = await this.properties.save(property);

    await this.audit.record({
      moduleName: 'properties',
      entityId: id,
      action: 'UPDATE',
      oldValue: { status: oldStatus },
      newValue: { status: saved.status },
      performedBy: actorId,
    });

    return saved;
  }

  async remove(id: number, actorId?: number) {
    const property = await this.properties.findOne({ where: { id } });
    if (!property) throw new NotFoundException('Property not found');

    await this.properties.softRemove(property);

    await this.audit.record({
      moduleName: 'properties',
      entityId: id,
      action: 'DELETE',
      oldValue: { name: property.name, code: property.code, status: property.status },
      performedBy: actorId,
    });

    return { deleted: true };
  }

  async findOneEntity(id: number): Promise<Property> {
    const property = await this.properties.findOne({ where: { id } });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }
}

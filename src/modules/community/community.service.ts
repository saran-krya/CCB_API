import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { Property } from '../property/entities/property.entity';
import {
  CommunityQueryDto,
  CreateCommunityDto,
  UpdateCommunityDto,
  UpdateCommunityStatusDto,
} from './dto/create-community.dto';
import { CommunityDetailDto, CommunityListDto } from './dto/community-response.dto';
import { Community, CommunityStatus } from './entities/community.entity';

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(Community)
    private readonly communities: Repository<Community>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async getStats() {
    const [totalCommunities, statsRows] = await Promise.all([
      this.communities.count(),
      this.dataSource.query<any[]>(`
        SELECT
          COUNT(DISTINCT p.id) AS totalProperties,
          COUNT(DISTINCT u.id) AS totalUnits,
          SUM(CASE WHEN u.occupancy_status = 'occupied' THEN 1 ELSE 0 END) AS occupiedUnits,
          SUM(CASE WHEN u.occupancy_status = 'vacant' THEN 1 ELSE 0 END) AS vacantUnits
        FROM properties p
        LEFT JOIN units u ON u.property_id = p.id AND u.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
      `),
    ]);

    const row = statsRows[0] ?? {};
    return {
      totalCommunities,
      totalProperties: Number(row.totalProperties ?? 0),
      totalUnits: Number(row.totalUnits ?? 0),
      occupiedUnits: Number(row.occupiedUnits ?? 0),
      vacantUnits: Number(row.vacantUnits ?? 0),
    };
  }

  async create(
    dto: CreateCommunityDto | CreateCommunityDto[],
    actorId?: number,
  ) {
    const isBulk = Array.isArray(dto);
    const payload = isBulk ? dto : [dto];
    const codes = payload.map((x) => x.code);

    const existing = await this.communities.find({ where: { code: In(codes) } });
    if (existing.length) {
      throw new ConflictException(
        `Community code already exists: ${existing.map((x) => x.code).join(', ')}`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const entities = manager.create(
        Community,
        payload.map((item) => ({
          ...item,
          status: item.status ?? CommunityStatus.ACTIVE,
        })),
      );
      const saved = await manager.save(Community, entities);

      await Promise.all(
        saved.map((c) =>
          this.audit.record({
            moduleName: 'communities',
            entityId: c.id,
            action: 'CREATE',
            newValue: { name: c.name, code: c.code, status: c.status },
            performedBy: actorId,
          }),
        ),
      );

      return isBulk ? saved : saved[0];
    });
  }

  async findAll(query: CommunityQueryDto) {
    const { status, city, search, sortBy, sortOrder } = query;

    const qb = this.communities
      .createQueryBuilder('c')
      .select([
        'c.id', 'c.name', 'c.code', 'c.status',
        'c.location', 'c.city', 'c.state', 'c.country', 'c.createdAt',
      ])
      .loadRelationCountAndMap('c.totalProperties', 'c.properties', 'p', (sub) =>
        sub.where('p.deleted_at IS NULL'),
      )
      .orderBy(`c.${sortBy ?? 'createdAt'}`, sortOrder ?? 'DESC');

    if (search) {
      qb.andWhere(
        '(c.name LIKE :s OR c.code LIKE :s OR c.city LIKE :s OR c.location LIKE :s)',
        { s: `%${search}%` },
      );
    }
    if (status) qb.andWhere('c.status = :status', { status });
    if (city) qb.andWhere('c.city LIKE :city', { city: `%${city}%` });

    const result = await paginate(qb, query);

    // Batch-fetch unit counts for the current page (avoids N+1)
    let totalUnitsMap: Record<number, number> = {};
    if (result.items.length > 0) {
      const ids = result.items.map((c) => c.id);
      const rows = await this.dataSource.query<Array<{ community_id: number; totalUnits: string }>>(
        `SELECT p.community_id, COUNT(u.id) AS totalUnits
         FROM properties p
         LEFT JOIN units u ON u.property_id = p.id AND u.deleted_at IS NULL
         WHERE p.community_id IN (${ids.map(() => '?').join(',')}) AND p.deleted_at IS NULL
         GROUP BY p.community_id`,
        ids,
      );
      totalUnitsMap = Object.fromEntries(rows.map((r) => [r.community_id, Number(r.totalUnits)]));
    }

    const items: CommunityListDto[] = result.items.map((c: any) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      location: c.location ?? null,
      totalProperties: c.totalProperties ?? 0,
      totalUnits: totalUnitsMap[c.id] ?? 0,
      status: c.status,
      createdDate: (c.createdAt as Date)?.toISOString() ?? '',
      city: c.city ?? null,
      state: c.state ?? null,
      country: c.country ?? null,
    }));
    return { items, pagination: result.pagination };
  }

  async findOne(id: number): Promise<CommunityDetailDto> {
    const community = await this.communities.findOne({ where: { id } });
    if (!community) throw new NotFoundException('Community not found');

    const [properties, statsRows] = await Promise.all([
      this.properties.find({
        where: { community: { id } },
        select: { id: true, name: true, code: true, propertyType: true, numberOfFloors: true, status: true },
        order: { createdAt: 'DESC' },
      }),
      this.dataSource.query<any[]>(
        `
        SELECT
          COUNT(DISTINCT u.id)                                                        AS totalUnits,
          SUM(CASE WHEN u.unit_type IN ('apartment','studio') THEN 1 ELSE 0 END)     AS residentialUnits,
          SUM(CASE WHEN u.unit_type IN ('office','shop','garage') THEN 1 ELSE 0 END) AS commercialUnits,
          SUM(CASE WHEN u.occupancy_status = 'occupied' THEN 1 ELSE 0 END)           AS occupiedUnits,
          SUM(CASE WHEN u.occupancy_status = 'vacant'   THEN 1 ELSE 0 END)           AS vacantUnits
        FROM properties p
        LEFT JOIN units u ON u.property_id = p.id AND u.deleted_at IS NULL
        WHERE p.community_id = ? AND p.deleted_at IS NULL
        `,
        [id],
      ),
    ]);

    // Batch unit counts per property for the PropertiesTable totalUnits column
    let propertyUnitCountMap: Record<number, number> = {};
    if (properties.length > 0) {
      const pIds = properties.map((p) => p.id);
      const pRows = await this.dataSource.query<Array<{ property_id: number; cnt: string }>>(
        `SELECT property_id, COUNT(id) AS cnt FROM units
         WHERE property_id IN (${pIds.map(() => '?').join(',')}) AND deleted_at IS NULL
         GROUP BY property_id`,
        pIds,
      );
      propertyUnitCountMap = Object.fromEntries(pRows.map((r) => [r.property_id, Number(r.cnt)]));
    }

    const row = statsRows[0] ?? {};
    return {
      id: community.id,
      name: community.name,
      code: community.code,
      status: community.status,
      description: community.description ?? null,
      createdDate: community.createdAt?.toISOString() ?? '',
      location: community.location ?? null,
      address: community.address ?? null,
      city: community.city ?? null,
      state: community.state ?? null,
      zipCode: community.zipCode ?? null,
      country: community.country ?? null,
      contactPerson: community.contactPerson ?? null,
      contactEmail: community.contactEmail ?? null,
      contactPhone: community.contactPhone ?? null,
      totalProperties: properties.length,
      totalUnits: Number(row.totalUnits ?? 0),
      residentialUnits: Number(row.residentialUnits ?? 0),
      commercialUnits: Number(row.commercialUnits ?? 0),
      occupiedUnits: Number(row.occupiedUnits ?? 0),
      vacantUnits: Number(row.vacantUnits ?? 0),
      totalMasterMeters: 0,
      totalSubMeters: 0,
      mappedMeters: 0,
      unmappedMeters: 0,
      properties: properties.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        propertyType: p.propertyType,
        numberOfFloors: p.numberOfFloors,
        status: p.status,
        totalUnits: propertyUnitCountMap[p.id] ?? 0,
      })),
    };
  }

  async update(id: number, dto: UpdateCommunityDto, actorId?: number) {
    const community = await this.findOneEntity(id);

    if (dto.code && dto.code !== community.code) {
      const exists = await this.communities.findOne({ where: { code: dto.code } });
      if (exists) throw new ConflictException('Community code already exists');
    }

    const oldValue = { name: community.name, code: community.code, status: community.status };
    Object.assign(community, dto);
    const saved = await this.communities.save(community);

    await this.audit.record({
      moduleName: 'communities',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: { name: saved.name, code: saved.code, status: saved.status },
      performedBy: actorId,
    });

    return saved;
  }

  async updateStatus(id: number, dto: UpdateCommunityStatusDto, actorId?: number) {
    const community = await this.findOneEntity(id);
    const oldStatus = community.status;
    community.status = dto.status;
    const saved = await this.communities.save(community);

    await this.audit.record({
      moduleName: 'communities',
      entityId: id,
      action: 'UPDATE',
      oldValue: { status: oldStatus },
      newValue: { status: saved.status },
      performedBy: actorId,
    });

    return saved;
  }

  async remove(id: number, actorId?: number) {
    const community = await this.findOneEntity(id);
    await this.communities.softRemove(community);

    await this.audit.record({
      moduleName: 'communities',
      entityId: id,
      action: 'DELETE',
      oldValue: { name: community.name, code: community.code, status: community.status },
      performedBy: actorId,
    });

    return { deleted: true };
  }

  async findOneEntity(id: number): Promise<Community> {
    const community = await this.communities.findOne({ where: { id } });
    if (!community) throw new NotFoundException('Community not found');
    return community;
  }
}

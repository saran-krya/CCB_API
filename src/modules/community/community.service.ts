import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/utils/pagination.util';
import {
  CreateCommunityDto,
  UpdateCommunityDto,
} from './dto/create-community.dto';
import { Community } from './entities/community.entity';

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(Community)
    private readonly communities: Repository<Community>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    dto: CreateCommunityDto | CreateCommunityDto[],
    actorId?: number,
  ) {
    const isBulk = Array.isArray(dto);
    const payload = isBulk ? dto : [dto];

    const codes = payload.map((x) => x.code);

    const existing = await this.communities.find({
      where: {
        code: In(codes),
      },
    });

    if (existing.length) {
      throw new ConflictException(
        `Community code already exists: ${existing
          .map((x) => x.code)
          .join(', ')}`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const entities = manager.create(
        Community,
        payload.map((item) => ({
          ...item,
          status: item.status ?? true,
        })),
      );

      const saved = await manager.save(Community, entities);

      await Promise.all(
        saved.map((community) =>
          this.audit.record({
            moduleName: 'communities',
            entityId: community.id,
            action: 'CREATE',
            newValue: {
              name: community.name,
              code: community.code,
              status: community.status,
            },
            performedBy: actorId,
          }),
        ),
      );

      return isBulk ? saved : saved[0];
    });
  }

  findAll(query: PaginationQueryDto) {
    const qb = this.communities
      .createQueryBuilder('community')
      .orderBy('community.createdAt', 'DESC');

    if (query.search) {
      qb.where(
        'community.name LIKE :search OR community.code LIKE :search',
        {
          search: `%${query.search}%`,
        },
      );
    }

    return paginate(qb, query);
  }

  async findOne(id: number) {
    const community = await this.communities.findOne({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException(
        'Community not found',
      );
    }

    return community;
  }

  async update(
    id: number,
    dto: UpdateCommunityDto,
    actorId?: number,
  ) {
    const community = await this.findOne(id);

    if (dto.code) {
      const exists = await this.communities.findOne({
        where: {
          code: dto.code,
        },
      });

      if (exists && exists.id !== id) {
        throw new ConflictException(
          'Community code already exists',
        );
      }
    }

    const oldValue = {
      name: community.name,
      code: community.code,
      status: community.status,
    };

    Object.assign(community, dto);

    const saved = await this.communities.save(community);

    await this.audit.record({
      moduleName: 'communities',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: {
        name: saved.name,
        code: saved.code,
        status: saved.status,
      },
      performedBy: actorId,
    });

    return saved;
  }

  async remove(
    id: number,
    actorId?: number,
  ) {
    const community = await this.findOne(id);

    await this.communities.softRemove(
      community,
    );

    await this.audit.record({
      moduleName: 'communities',
      entityId: id,
      action: 'DELETE',
      oldValue: {
        name: community.name,
        code: community.code,
        status: community.status,
      },
      performedBy: actorId,
    });

    return {
      deleted: true,
    };
  }
}
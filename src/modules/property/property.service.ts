import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/utils/pagination.util';
import { CommunityService } from '../community/community.service';
import {
  CreatePropertyDto,
  UpdatePropertyDto,
} from './dto/create-property.dto';
import { Property } from './entities/property.entity';

@Injectable()
export class PropertyService {
  constructor(
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly communities: CommunityService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    dto: CreatePropertyDto,
    actorId?: number,
  ) {
    const existing = await this.properties.findOne({
      where: {
        propertyCode: dto.propertyCode,
      },
    });

    if (existing) {
      throw new ConflictException(
        'Property code already exists',
      );
    }

    const community = await this.communities.findOne(
      dto.communityId,
    );

    return this.dataSource.transaction(async (manager) => {
      const property = manager.create(Property, {
        ...dto,
        community,
        status: dto.status ?? true,
      });

      const saved = await manager.save(
        Property,
        property,
      );

      await this.audit.record({
        moduleName: 'properties',
        entityId: saved.id,
        action: 'CREATE',
        newValue: {
          propertyName: saved.propertyName,
          propertyCode: saved.propertyCode,
          status: saved.status,
        },
        performedBy: actorId,
      });

      return saved;
    });
  }

  findAll(query: PaginationQueryDto) {
    const qb = this.properties
      .createQueryBuilder('property')
      .leftJoinAndSelect(
        'property.community',
        'community',
      )
      .orderBy(
        'property.createdAt',
        'DESC',
      );

    if (query.search) {
      qb.where(
        'property.propertyName LIKE :search OR property.propertyCode LIKE :search',
        {
          search: `%${query.search}%`,
        },
      );
    }

    return paginate(qb, query);
  }

  async findOne(id: number) {
    const property =
      await this.properties.findOne({
        where: { id },
        relations: {
          community: true,
        },
      });

    if (!property) {
      throw new NotFoundException(
        'Property not found',
      );
    }

    return property;
  }

  async update(
    id: number,
    dto: UpdatePropertyDto,
    actorId?: number,
  ) {
    const property =
      await this.findOne(id);

    if (dto.propertyCode) {
      const exists =
        await this.properties.findOne({
          where: {
            propertyCode:
              dto.propertyCode,
          },
        });

      if (
        exists &&
        exists.id !== id
      ) {
        throw new ConflictException(
          'Property code already exists',
        );
      }
    }

    const oldValue = {
      propertyName:
        property.propertyName,
      propertyCode:
        property.propertyCode,
      status: property.status,
    };

    if (dto.communityId) {
      property.community =
        await this.communities.findOne(
          dto.communityId,
        );
    }

    Object.assign(property, {
      propertyName:
        dto.propertyName ??
        property.propertyName,
      propertyCode:
        dto.propertyCode ??
        property.propertyCode,
      status:
        dto.status ??
        property.status,
    });

    const saved =
      await this.properties.save(
        property,
      );

    await this.audit.record({
      moduleName: 'properties',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: {
        propertyName:
          saved.propertyName,
        propertyCode:
          saved.propertyCode,
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
    const property =
      await this.findOne(id);

    await this.properties.softRemove(
      property,
    );

    await this.audit.record({
      moduleName: 'properties',
      entityId: id,
      action: 'DELETE',
      oldValue: {
        propertyName:
          property.propertyName,
        propertyCode:
          property.propertyCode,
        status: property.status,
      },
      performedBy: actorId,
    });

    return {
      deleted: true,
    };
  }
}
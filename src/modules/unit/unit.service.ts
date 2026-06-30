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
import { PropertyService } from '../property/property.service';
import {
  CreateUnitDto,
  UpdateUnitDto,
} from './dto/create-unit.dto';
import { Unit } from './entities/unit.entity';

@Injectable()
export class UnitService {
  constructor(
    @InjectRepository(Unit)
    private readonly units: Repository<Unit>,
    private readonly properties: PropertyService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    dto: CreateUnitDto,
    actorId?: number,
  ) {
    const property =
      await this.properties.findOne(
        dto.propertyId,
      );

    const existing =
      await this.units.findOne({
        where: {
          unitNo: dto.unitNo,
          property: {
            id: dto.propertyId,
          },
        },
        relations: {
          property: true,
        },
      });

    if (existing) {
      throw new ConflictException(
        'Unit number already exists in this property',
      );
    }

    return this.dataSource.transaction(
      async (manager) => {
        const unit = manager.create(
          Unit,
          {
            property,
            unitNo: dto.unitNo,
            unitType: dto.unitType,
            area: dto.area.toString(),
            occupancyType:
              dto.occupancyType,
            status:
              dto.status ?? true,
          },
        );

        const saved =
          await manager.save(
            Unit,
            unit,
          );

        await this.audit.record({
          moduleName: 'units',
          entityId: saved.id,
          action: 'CREATE',
          newValue: {
            unitNo: saved.unitNo,
            unitType:
              saved.unitType,
            area: saved.area,
            occupancyType:
              saved.occupancyType,
            status: saved.status,
          },
          performedBy: actorId,
        });

        return saved;
      },
    );
  }

  findAll(query: PaginationQueryDto) {
    const qb = this.units
      .createQueryBuilder('unit')
      .leftJoinAndSelect(
        'unit.property',
        'property',
      )
      .leftJoinAndSelect(
        'property.community',
        'community',
      )
      .orderBy(
        'unit.createdAt',
        'DESC',
      );

    if (query.search) {
      qb.where(
        `
        unit.unitNo LIKE :search
        OR unit.unitType LIKE :search
        OR unit.occupancyType LIKE :search
      `,
        {
          search: `%${query.search}%`,
        },
      );
    }

    return paginate(qb, query);
  }

  async findOne(id: number) {
    const unit =
      await this.units.findOne({
        where: { id },
        relations: {
          property: {
            community: true,
          },
        },
      });

    if (!unit) {
      throw new NotFoundException(
        'Unit not found',
      );
    }

    return unit;
  }

  async update(
    id: number,
    dto: UpdateUnitDto,
    actorId?: number,
  ) {
    const unit =
      await this.findOne(id);

    if (dto.propertyId) {
      unit.property =
        await this.properties.findOne(
          dto.propertyId,
        );
    }

    const propertyId =
      dto.propertyId ??
      unit.property.id;

    if (dto.unitNo) {
      const exists =
        await this.units.findOne({
          where: {
            unitNo: dto.unitNo,
            property: {
              id: propertyId,
            },
          },
          relations: {
            property: true,
          },
        });

      if (
        exists &&
        exists.id !== id
      ) {
        throw new ConflictException(
          'Unit number already exists in this property',
        );
      }
    }

    const oldValue = {
      unitNo: unit.unitNo,
      unitType: unit.unitType,
      area: unit.area,
      occupancyType:
        unit.occupancyType,
      status: unit.status,
    };

    Object.assign(unit, {
      unitNo:
        dto.unitNo ??
        unit.unitNo,
      unitType:
        dto.unitType ??
        unit.unitType,
      area:
        dto.area !== undefined
          ? dto.area.toString()
          : unit.area,
      occupancyType:
        dto.occupancyType ??
        unit.occupancyType,
      status:
        dto.status ??
        unit.status,
    });

    const saved =
      await this.units.save(unit);

    await this.audit.record({
      moduleName: 'units',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: {
        unitNo: saved.unitNo,
        unitType:
          saved.unitType,
        area: saved.area,
        occupancyType:
          saved.occupancyType,
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
    const unit =
      await this.findOne(id);

    await this.units.softRemove(
      unit,
    );

    await this.audit.record({
      moduleName: 'units',
      entityId: id,
      action: 'DELETE',
      oldValue: {
        unitNo: unit.unitNo,
        unitType:
          unit.unitType,
        area: unit.area,
        occupancyType:
          unit.occupancyType,
        status: unit.status,
      },
      performedBy: actorId,
    });

    return {
      deleted: true,
    };
  }
}
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { paginate } from '@app/common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

import {
  CreateSubModuleDto,
  UpdateSubModuleDto,
} from './dto/create-sub-module.dto';

import { SubModule } from './entities/sub-module.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';

@Injectable()
export class SubModulesService {
  constructor(
    @InjectRepository(SubModule)
    private readonly subModuleRepository: Repository<SubModule>,

    @InjectRepository(PModule)
    private readonly pModuleRepository: Repository<PModule>,
  ) {}

  async create(
    dto: CreateSubModuleDto,
  ) {
    const pModule =
      await this.pModuleRepository.findOne({
        where: {
          id: dto.pModuleId,
        },
      });

    if (!pModule) {
      throw new NotFoundException(
        'Permission module not found',
      );
    }

    const exists =
      await this.subModuleRepository.findOne({
        where: [
          {
            name: dto.name,
          },
          {
            code: dto.code,
          },
        ],
      });

    if (exists) {
      throw new ConflictException(
        'Sub module already exists',
      );
    }

    const subModule =
      this.subModuleRepository.create(dto);

    return this.subModuleRepository.save(
      subModule,
    );
  }

  async findAll() {
  return this.subModuleRepository.find({
    relations: {
      pModule: true,
    },
    select: {
      id: true,
      name: true,
      code: true,
      url: true,
      icon: true,
      displayOrder: true,
      isActive: true,
      pModuleId: true,
      pModule: {
        id: true,
        moduleName: true,
      },
    },
    order: {
      displayOrder: 'ASC',
    },
  });
}
  async findOne(
    id: number,
  ) {
    const subModule =
      await this.subModuleRepository.findOne({
        where: {
          id,
        },
        relations: {
          pModule: true,
          screens: true,
        },
      });

    if (!subModule) {
      throw new NotFoundException(
        'Sub module not found',
      );
    }

    return subModule;
  }

  async update(
    id: number,
    dto: UpdateSubModuleDto,
  ) {
    const subModule =
      await this.findOne(id);

    if (
      dto.pModuleId &&
      dto.pModuleId !==
        subModule.pModuleId
    ) {
      const pModule =
        await this.pModuleRepository.findOne({
          where: {
            id: dto.pModuleId,
          },
        });

      if (!pModule) {
        throw new NotFoundException(
          'Permission module not found',
        );
      }
    }

    if (
      dto.name &&
      dto.name !== subModule.name
    ) {
      const exists =
        await this.subModuleRepository.findOne({
          where: {
            name: dto.name,
          },
        });

      if (exists) {
        throw new ConflictException(
          'Sub module already exists',
        );
      }
    }

    if (
      dto.code &&
      dto.code !== subModule.code
    ) {
      const exists =
        await this.subModuleRepository.findOne({
          where: {
            code: dto.code,
          },
        });

      if (exists) {
        throw new ConflictException(
          'Sub module code already exists',
        );
      }
    }

    Object.assign(
      subModule,
      dto,
    );

    return this.subModuleRepository.save(
      subModule,
    );
  }

  async remove(
    id: number,
  ) {
    const subModule =
      await this.findOne(id);

    await this.subModuleRepository.softRemove(
      subModule,
    );

    return {
      message:
        'Sub module deleted successfully',
    };
  }
}
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { isProtectedModuleCode } from '../pmodules/pmodules.constants';
import { SUB_MODULES } from '../../bootstrap/seed-data';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';

@Injectable()
export class SubModulesService {
  private readonly logger = new Logger(SubModulesService.name);

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
        ERROR_MESSAGES.PERMISSION_MODULE_NOT_FOUND,
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
        ERROR_MESSAGES.SUB_MODULE_ALREADY_EXISTS,
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
      displayOrder: SORT_ORDER.ASC,
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
        ERROR_MESSAGES.SUB_MODULE_NOT_FOUND,
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

    // A sub-module that currently belongs to a protected module (pmodules.constants.ts) is itself protected: it
    // cannot be deactivated, re-coded, re-parented away, or (see remove() below) deleted — each would dismantle
    // the protected module's functionality just as effectively as touching the module row directly.
    if (isProtectedModuleCode(subModule.pModule?.code)) {
      if (dto.isActive === false) {
        throw new ForbiddenException(ERROR_MESSAGES.SUB_MODULE_PROTECTED_CANNOT_DEACTIVATE);
      }
      if (dto.code !== undefined && dto.code !== subModule.code) {
        throw new ForbiddenException(ERROR_MESSAGES.SUB_MODULE_PROTECTED_CODE_LOCKED);
      }
      if (dto.pModuleId !== undefined && dto.pModuleId !== subModule.pModuleId) {
        throw new ForbiddenException(ERROR_MESSAGES.SUB_MODULE_PROTECTED_CANNOT_REPARENT);
      }
    }

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
          ERROR_MESSAGES.PERMISSION_MODULE_NOT_FOUND,
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
          ERROR_MESSAGES.SUB_MODULE_ALREADY_EXISTS,
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

    if (isProtectedModuleCode(subModule.pModule?.code)) {
      throw new ForbiddenException(ERROR_MESSAGES.SUB_MODULE_PROTECTED_CANNOT_DELETE);
    }
    // Deleting a sub-module that still has screens would leave them attached to nothing (the same rule
    // PModulesService.remove() applies one level up).
    if ((subModule.screens?.length ?? 0) > 0) {
      throw new ConflictException(ERROR_MESSAGES.SUB_MODULE_HAS_CHILDREN);
    }

    await this.subModuleRepository.softRemove(
      subModule,
    );

    return {
      message:
        'Sub module deleted successfully',
    };
  }

  async ensureCriticalDefaults(): Promise<void> {
    for (const sm of SUB_MODULES) {
      try {
        const exists = await this.subModuleRepository.findOne({
          where: [{ code: sm.code }, { name: sm.name }],
        });
        if (exists) continue;

        const pModule = await this.pModuleRepository.findOne({ where: { code: sm.pModuleCode } });
        if (!pModule) {
          this.logger.warn(`SubModule "${sm.code}" skipped — PModule "${sm.pModuleCode}" not found`);
          continue;
        }

        const entity = this.subModuleRepository.create({
          pModuleId: pModule.id,
          name: sm.name,
          code: sm.code,
          icon: sm.icon,
          url: sm.url,
          displayOrder: sm.displayOrder,
          isActive: true,
        });
        await this.subModuleRepository.save(entity);
        this.logger.debug(`Backfilled sub-module "${sm.code}"`);
      } catch (err) {
        this.logger.error(`Failed to backfill sub-module "${sm.code}" — skipping`, err as Error);
      }
    }
  }
}
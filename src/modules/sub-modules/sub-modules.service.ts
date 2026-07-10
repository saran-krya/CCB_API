import {
  ConflictException,
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
import { SUB_MODULES } from '../../bootstrap/seed-data';

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

  // Backfills any SUB_MODULES seed row missing from an already-initialized
  // database — mirrors ScreensService/ActionsService/PModulesService's
  // ensureCriticalDefaults() pattern. Matched by code OR name (SubModule
  // has no DB-level unique constraint on name, but create()'s own duplicate
  // check treats the pair as effectively unique — same defensive lookup
  // used elsewhere for this reason) so this never creates a duplicate row.
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
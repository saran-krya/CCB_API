import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PModule } from './entities/pmodule.entity';

import {
  CreatePModuleDto,
  UpdatePModuleDto,
} from './dto/create-pmodule.dto';
import { PMODULES } from '../../bootstrap/seed-data';

const MODULE_NAME_CODE_FIXES: Record<string, string> = {
  'System Admin': 'SYSTEM_ADMIN',
};

@Injectable()
export class PModulesService {
  private readonly logger = new Logger(PModulesService.name);

  constructor(
    @InjectRepository(PModule)
    private readonly pModuleRepository: Repository<PModule>,
  ) {}

  async create(dto: CreatePModuleDto) {
    const exists =
      await this.pModuleRepository.findOne({
        where: {
          moduleName: dto.moduleName,
        },
      });

    if (exists) {
      throw new ConflictException(
        'Permission module already exists',
      );
    }

    const pModule =
      this.pModuleRepository.create(dto);

    return this.pModuleRepository.save(
      pModule,
    );
  }

async findAll() {
  return this.pModuleRepository.find({
    select: {
      id: true,
      moduleName: true,
      type: true,
      icon: true,
      url: true,
      displayOrder: true,
      isActive: true,
      code:true
    },
    order: {
      displayOrder: 'ASC',
    },
  });
}

  async findOne(id: number) {
    const pModule =
      await this.pModuleRepository.findOne({
        where: {
          id,
        },
        relations: {
          subModules: true,
        },
      });

    if (!pModule) {
      throw new NotFoundException(
        'Permission module not found',
      );
    }

    return pModule;
  }

  async update(
    id: number,
    dto: UpdatePModuleDto,
  ) {
    const pModule =
      await this.findOne(id);

    if (
      dto.moduleName &&
      dto.moduleName !==
        pModule.moduleName
    ) {
      const exists =
        await this.pModuleRepository.findOne({
          where: {
            moduleName:
              dto.moduleName,
          },
        });

      if (exists) {
        throw new ConflictException(
          'Permission module already exists',
        );
      }
    }

    Object.assign(pModule, dto);

    return this.pModuleRepository.save(
      pModule,
    );
  }

  async remove(id: number) {
    const pModule =
      await this.findOne(id);

    await this.pModuleRepository.softRemove(
      pModule,
    );

    return {
      message:
        'Permission module deleted successfully',
    };
  }

  async ensureCriticalDefaults(): Promise<void> {
    for (const [moduleName, correctCode] of Object.entries(MODULE_NAME_CODE_FIXES)) {
      try {
        const existing = await this.pModuleRepository.findOne({ where: { moduleName } });
        if (existing && existing.code !== correctCode) {
          this.logger.warn(`Correcting PModule "${moduleName}" code from "${existing.code}" to "${correctCode}"`);
          existing.code = correctCode;
          await this.pModuleRepository.save(existing);
        }
      } catch (err) {
        this.logger.error(`Failed to correct code for module "${moduleName}" — skipping`, err as Error);
      }
    }

    for (const pm of PMODULES) {
      try {
        const exists = await this.pModuleRepository.findOne({
          where: [{ code: pm.code }, { moduleName: pm.moduleName }],
        });
        if (exists) continue;

        const entity = this.pModuleRepository.create({
          moduleName: pm.moduleName,
          code: pm.code,
          type: pm.type,
          icon: pm.icon,
          url: pm.url,
          displayOrder: pm.displayOrder,
          isActive: true,
        });
        await this.pModuleRepository.save(entity);
        this.logger.debug(`Backfilled module "${pm.code}"`);
      } catch (err) {
        this.logger.error(`Failed to backfill module "${pm.code}" — skipping`, err as Error);
      }
    }
  }
}
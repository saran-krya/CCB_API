import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Screen } from './entities/screen.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';

import {
  CreateScreenDto,
  UpdateScreenDto,
} from './dto/create-screen.dto';
import { SCREENS } from '../../bootstrap/seed-data';

@Injectable()
export class ScreensService {
  private readonly logger = new Logger(ScreensService.name);

  constructor(
    @InjectRepository(Screen)
    private readonly screenRepository: Repository<Screen>,

    @InjectRepository(SubModule)
    private readonly subModuleRepository: Repository<SubModule>,

    @InjectRepository(PModule)
    private readonly pModuleRepository: Repository<PModule>,
  ) {}

  async create(dto: CreateScreenDto) {
    if (!dto.subModuleId && !dto.pModuleId) {
      throw new BadRequestException(
        'A screen must belong to either a SubModule (subModuleId) or a PModule (pModuleId).',
      );
    }

    if (dto.subModuleId && dto.pModuleId) {
      throw new BadRequestException(
        'A screen cannot belong to both a SubModule and a PModule. Provide only one.',
      );
    }

    if (dto.subModuleId) {
      const subModule = await this.subModuleRepository.findOne({
        where: { id: dto.subModuleId },
      });
      if (!subModule) throw new NotFoundException('Sub module not found');
    }

    if (dto.pModuleId) {
      const pModule = await this.pModuleRepository.findOne({
        where: { id: dto.pModuleId },
      });
      if (!pModule) throw new NotFoundException('Module not found');
    }

    const screen = this.screenRepository.create(dto);
    return this.screenRepository.save(screen);
  }

  async findAll() {
    return this.screenRepository.find({
      relations: {
        subModule: true,
        pModule: true,
      },
      select: {
        id: true,
        name: true,
        url: true,
        displayOrder: true,
        isActive: true,
        subModuleId: true,
        pModuleId: true,
        code: true,
        subModule: { id: true, name: true },
        pModule: { id: true, moduleName: true },
      },
      order: { displayOrder: 'ASC' },
    });
  }

  async findOne(id: number) {
    const screen = await this.screenRepository.findOne({
      where: { id },
      relations: ['subModule', 'pModule'],
    });

    if (!screen) throw new NotFoundException('Screen not found');
    return screen;
  }

  async update(id: number, dto: UpdateScreenDto) {
    const screen = await this.findOne(id);

    if (dto.subModuleId && dto.pModuleId) {
      throw new BadRequestException(
        'A screen cannot belong to both a SubModule and a PModule. Provide only one.',
      );
    }

    if (dto.subModuleId && dto.subModuleId !== screen.subModuleId) {
      const subModule = await this.subModuleRepository.findOne({
        where: { id: dto.subModuleId },
      });
      if (!subModule) throw new NotFoundException('Sub module not found');
    }

    if (dto.pModuleId && dto.pModuleId !== screen.pModuleId) {
      const pModule = await this.pModuleRepository.findOne({
        where: { id: dto.pModuleId },
      });
      if (!pModule) throw new NotFoundException('Module not found');
    }

    Object.assign(screen, dto);
    return this.screenRepository.save(screen);
  }

  async remove(id: number) {
    const screen = await this.findOne(id);
    await this.screenRepository.softRemove(screen);
    return { message: 'Screen deleted successfully' };
  }

  // Backfills any SCREENS seed row missing from an already-initialized
  // database — the one-time bootstrap seed (BootstrapService.seedScreens)
  // never runs again once a database has users, so a screen code added
  // after first boot (e.g. LOV_MASTER_SCREEN) would otherwise never be
  // inserted. Mirrors AttributeService/LovService's ensureCriticalDefaults()
  // pattern: check-by-code, skip if present, insert if missing.
  async ensureCriticalDefaults(): Promise<void> {
    for (const sc of SCREENS) {
      try {
        const exists = await this.screenRepository.findOne({ where: { code: sc.code } });
        if (exists) continue;

        let subModuleId: number | undefined;
        let pModuleId: number | undefined;

        if (sc.subModuleCode) {
          const subModule = await this.subModuleRepository.findOne({ where: { code: sc.subModuleCode } });
          if (!subModule) {
            this.logger.warn(`Screen "${sc.code}" skipped — SubModule "${sc.subModuleCode}" not found`);
            continue;
          }
          subModuleId = subModule.id;
        } else if (sc.pModuleCode) {
          const pModule = await this.pModuleRepository.findOne({ where: { code: sc.pModuleCode } });
          if (!pModule) {
            this.logger.warn(`Screen "${sc.code}" skipped — PModule "${sc.pModuleCode}" not found`);
            continue;
          }
          pModuleId = pModule.id;
        } else {
          this.logger.warn(`Screen "${sc.code}" skipped — neither subModuleCode nor pModuleCode specified`);
          continue;
        }

        const entity = this.screenRepository.create({
          subModuleId: subModuleId ?? null,
          pModuleId: pModuleId ?? null,
          name: sc.name,
          code: sc.code,
          url: sc.url ?? null,
          displayOrder: sc.displayOrder,
          isActive: true,
        });
        await this.screenRepository.save(entity);
        this.logger.debug(`Backfilled screen "${sc.code}"`);
      } catch (err) {
        // One unexpected row must not abort the whole backfill loop or
        // crash server startup — log it and keep going.
        this.logger.error(`Failed to backfill screen "${sc.code}" — skipping`, err as Error);
      }
    }
  }
}

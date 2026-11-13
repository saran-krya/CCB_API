import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Screen } from './entities/screen.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Action } from '../actions/entities/action.entity';
import { isProtectedModuleCode } from '../pmodules/pmodules.constants';

import {
  CreateScreenDto,
  UpdateScreenDto,
} from './dto/create-screen.dto';
import { SCREENS } from '../../bootstrap/seed-data';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';

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

    @InjectRepository(Action)
    private readonly actionRepository: Repository<Action>,
  ) {}

  /** The code of the module this screen actually belongs to right now — directly (`pModuleId`) or one level down
   *  through its sub-module (`subModuleId`) — whichever the screen's own parent columns say. A screen has exactly
   *  one of the two set (ScreenService.create/update enforce that), never both. */
  private owningModuleCode(screen: Screen): string | null | undefined {
    return screen.pModule?.code ?? screen.subModule?.pModule?.code;
  }

  async create(dto: CreateScreenDto) {
    if (!dto.subModuleId && !dto.pModuleId) {
      throw new BadRequestException(
        'A screen must belong to either a SubModule (subModuleId) or a PModule (pModuleId).',
      );
    }

    if (dto.subModuleId && dto.pModuleId) {
      throw new BadRequestException(
        ERROR_MESSAGES.SCREEN_PARENT_CONFLICT,
      );
    }

    if (dto.subModuleId) {
      const subModule = await this.subModuleRepository.findOne({
        where: { id: dto.subModuleId },
      });
      if (!subModule) throw new NotFoundException(ERROR_MESSAGES.SUB_MODULE_NOT_FOUND);
    }

    if (dto.pModuleId) {
      const pModule = await this.pModuleRepository.findOne({
        where: { id: dto.pModuleId },
      });
      if (!pModule) throw new NotFoundException(ERROR_MESSAGES.MODULE_NOT_FOUND);
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
      order: { displayOrder: SORT_ORDER.ASC },
    });
  }

  async findOne(id: number) {
    const screen = await this.screenRepository.findOne({
      where: { id },
      relations: ['subModule', 'subModule.pModule', 'pModule'],
    });

    if (!screen) throw new NotFoundException(ERROR_MESSAGES.SCREEN_NOT_FOUND);
    return screen;
  }

  async update(id: number, dto: UpdateScreenDto) {
    const screen = await this.findOne(id);

    // A screen that currently belongs (directly, or through its sub-module) to a protected module is itself
    // protected — the same reasoning as SubModulesService's own check, one level further down the tree.
    if (isProtectedModuleCode(this.owningModuleCode(screen))) {
      if (dto.isActive === false) {
        throw new ForbiddenException(ERROR_MESSAGES.SCREEN_PROTECTED_CANNOT_DEACTIVATE);
      }
      if (dto.code !== undefined && dto.code !== screen.code) {
        throw new ForbiddenException(ERROR_MESSAGES.SCREEN_PROTECTED_CODE_LOCKED);
      }
      const movesSubModule = dto.subModuleId !== undefined && dto.subModuleId !== screen.subModuleId;
      const movesPModule = dto.pModuleId !== undefined && dto.pModuleId !== screen.pModuleId;
      if (movesSubModule || movesPModule) {
        throw new ForbiddenException(ERROR_MESSAGES.SCREEN_PROTECTED_CANNOT_REPARENT);
      }
    }

    if (dto.subModuleId && dto.pModuleId) {
      throw new BadRequestException(
        ERROR_MESSAGES.SCREEN_PARENT_CONFLICT,
      );
    }

    if (dto.subModuleId && dto.subModuleId !== screen.subModuleId) {
      const subModule = await this.subModuleRepository.findOne({
        where: { id: dto.subModuleId },
      });
      if (!subModule) throw new NotFoundException(ERROR_MESSAGES.SUB_MODULE_NOT_FOUND);
    }

    if (dto.pModuleId && dto.pModuleId !== screen.pModuleId) {
      const pModule = await this.pModuleRepository.findOne({
        where: { id: dto.pModuleId },
      });
      if (!pModule) throw new NotFoundException(ERROR_MESSAGES.MODULE_NOT_FOUND);
    }

    Object.assign(screen, dto);
    return this.screenRepository.save(screen);
  }

  async remove(id: number) {
    const screen = await this.findOne(id);

    if (isProtectedModuleCode(this.owningModuleCode(screen))) {
      throw new ForbiddenException(ERROR_MESSAGES.SCREEN_PROTECTED_CANNOT_DELETE);
    }
    // Deleting a screen that still defines actions would leave them attached to nothing (the same rule
    // PModulesService.remove() / SubModulesService.remove() apply one and two levels up).
    const actionCount = await this.actionRepository.count({ where: { screenId: id } });
    if (actionCount > 0) {
      throw new ConflictException(ERROR_MESSAGES.SCREEN_HAS_CHILDREN);
    }

    await this.screenRepository.softRemove(screen);
    return { message: 'Screen deleted successfully' };
  }

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
        this.logger.error(`Failed to backfill screen "${sc.code}" — skipping`, err as Error);
      }
    }
  }
}

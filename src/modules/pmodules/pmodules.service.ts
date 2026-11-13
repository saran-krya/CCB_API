import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PModule } from './entities/pmodule.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { Screen } from '../screens/entities/screen.entity';
import { Action } from '../actions/entities/action.entity';
import {
  CatalogModule,
  CatalogScreen,
  CatalogSubModule,
  ModuleCatalogQueryDto,
  ModuleCatalogResponse,
} from './dto/module-catalog.dto';
import { isProtectedModuleCode, MODULE_CATALOG_STATUS_FILTER } from './pmodules.constants';

import {
  CreatePModuleDto,
  UpdatePModuleDto,
} from './dto/create-pmodule.dto';
import { PMODULES } from '../../bootstrap/seed-data';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';

const MODULE_NAME_CODE_FIXES: Record<string, string> = {
  'System Admin': 'SYSTEM_ADMIN',
};

@Injectable()
export class PModulesService {
  private readonly logger = new Logger(PModulesService.name);

  constructor(
    @InjectRepository(PModule)
    private readonly pModuleRepository: Repository<PModule>,
    @InjectRepository(SubModule)
    private readonly subModuleRepository: Repository<SubModule>,
    @InjectRepository(Screen)
    private readonly screenRepository: Repository<Screen>,
    @InjectRepository(Action)
    private readonly actionRepository: Repository<Action>,
  ) {}

  /**
   * The whole module catalog as the administrator manages it: every module (inactive ones too) with its sub-modules, the screens
   * under them and how many permission actions each screen defines. Assembled here so the screen is a thin view. `search` keeps a
   * module when its own name/code — or any sub-module's or screen's under it — matches; `status` filters on the module's own
   * availability. The totals always describe the WHOLE catalog.
   */
  async getCatalog(query: ModuleCatalogQueryDto = {}): Promise<ModuleCatalogResponse> {
    const order = { displayOrder: SORT_ORDER.ASC, id: SORT_ORDER.ASC } as const;
    const [modules, subModules, screens, actionRows] = await Promise.all([
      this.pModuleRepository.find({ order }),
      this.subModuleRepository.find({ order }),
      this.screenRepository.find({ order }),
      this.actionRepository
        .createQueryBuilder('action')
        .select('action.screenId', 'screenId')
        .addSelect('COUNT(*)', 'count')
        .where('action.isActive = :active', { active: true })
        .andWhere('action.screenId IS NOT NULL')
        .groupBy('action.screenId')
        .getRawMany<{ screenId: number | string; count: number | string }>(),
    ]);

    const actionCounts = new Map(actionRows.map((row) => [Number(row.screenId), Number(row.count)]));
    // Resolves whether a screen or sub-module is itself protected (see SubModulesService/ScreensService): a module's
    // own code (moduleCodeById), and each sub-module's parent module id (subModulePModuleId), are enough to answer it
    // for every screen regardless of which of the two ways it is attached (subModuleId or pModuleId directly).
    const moduleCodeById = new Map(modules.map((module) => [module.id, module.code]));
    const subModulePModuleId = new Map(subModules.map((subModule) => [subModule.id, subModule.pModuleId]));
    const isScreenProtected = (screen: Screen): boolean => {
      const pModuleId = screen.pModuleId ?? (screen.subModuleId ? subModulePModuleId.get(screen.subModuleId) : undefined);
      return isProtectedModuleCode(pModuleId !== undefined ? moduleCodeById.get(pModuleId) : undefined);
    };
    const toScreen = (screen: Screen): CatalogScreen => ({
      id: screen.id,
      name: screen.name,
      code: screen.code,
      url: screen.url ?? null,
      displayOrder: screen.displayOrder,
      isActive: screen.isActive,
      actionCount: actionCounts.get(screen.id) ?? 0,
      isProtected: isScreenProtected(screen),
    });

    const screensOfSubModule = new Map<number, CatalogScreen[]>();
    const screensOfModule = new Map<number, CatalogScreen[]>();
    for (const screen of screens) {
      const target = screen.subModuleId ? screensOfSubModule : screen.pModuleId ? screensOfModule : null;
      const key = screen.subModuleId ?? screen.pModuleId;
      if (!target || !key) continue; // a screen attached to nothing is not part of any module's catalog
      target.set(key, [...(target.get(key) ?? []), toScreen(screen)]);
    }
    const subModulesOfModule = new Map<number, CatalogSubModule[]>();
    for (const subModule of subModules) {
      const entry: CatalogSubModule = {
        id: subModule.id,
        name: subModule.name,
        code: subModule.code,
        url: subModule.url ?? null,
        displayOrder: subModule.displayOrder,
        isActive: subModule.isActive,
        screens: screensOfSubModule.get(subModule.id) ?? [],
        isProtected: isProtectedModuleCode(moduleCodeById.get(subModule.pModuleId)),
      };
      subModulesOfModule.set(subModule.pModuleId, [...(subModulesOfModule.get(subModule.pModuleId) ?? []), entry]);
    }

    const catalog: CatalogModule[] = modules.map((module) => ({
      id: module.id,
      moduleName: module.moduleName,
      code: module.code,
      type: module.type,
      icon: module.icon ?? null,
      url: module.url ?? null,
      displayOrder: module.displayOrder ?? 0,
      isActive: module.isActive !== false,
      isProtected: isProtectedModuleCode(module.code),
      subModules: subModulesOfModule.get(module.id) ?? [],
      screens: screensOfModule.get(module.id) ?? [],
    }));

    const term = query.search?.trim().toLowerCase();
    const matches = (name: string, code: string) => name.toLowerCase().includes(term!) || code.toLowerCase().includes(term!);
    const statusFilter = query.status ?? MODULE_CATALOG_STATUS_FILTER.ALL;
    const visible = catalog.filter((module) => {
      if (statusFilter === MODULE_CATALOG_STATUS_FILTER.ACTIVE && !module.isActive) return false;
      if (statusFilter === MODULE_CATALOG_STATUS_FILTER.INACTIVE && module.isActive) return false;
      if (!term) return true;
      return (
        matches(module.moduleName, module.code) ||
        module.screens.some((screen) => matches(screen.name, screen.code)) ||
        module.subModules.some(
          (sub) => matches(sub.name, sub.code) || sub.screens.some((screen) => matches(screen.name, screen.code)),
        )
      );
    });

    return {
      totals: {
        modules: catalog.length,
        activeModules: catalog.filter((module) => module.isActive).length,
        subModules: subModules.length,
        screens: screens.length,
        actions: [...actionCounts.values()].reduce((sum, count) => sum + count, 0),
      },
      modules: visible,
    };
  }

  async create(dto: CreatePModuleDto) {
    const exists =
      await this.pModuleRepository.findOne({
        where: {
          moduleName: dto.moduleName,
        },
      });

    if (exists) {
      throw new ConflictException(
        ERROR_MESSAGES.PERMISSION_MODULE_ALREADY_EXISTS,
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
      displayOrder: SORT_ORDER.ASC,
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
        ERROR_MESSAGES.PERMISSION_MODULE_NOT_FOUND,
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

    // A module the platform needs keeps its code and stays available: an inactive module disappears from every user's menu.
    if (isProtectedModuleCode(pModule.code)) {
      if (dto.isActive === false) {
        throw new ForbiddenException(ERROR_MESSAGES.MODULE_PROTECTED_CANNOT_DEACTIVATE);
      }
      if (dto.code !== undefined && dto.code !== pModule.code) {
        throw new ForbiddenException(ERROR_MESSAGES.MODULE_PROTECTED_CODE_LOCKED);
      }
    }

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
          ERROR_MESSAGES.PERMISSION_MODULE_ALREADY_EXISTS,
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

    if (isProtectedModuleCode(pModule.code)) {
      throw new ForbiddenException(ERROR_MESSAGES.MODULE_PROTECTED_CANNOT_DELETE);
    }
    // Deleting a module that still has sub-modules or screens would leave them attached to nothing.
    const screenCount = await this.screenRepository.count({ where: { pModuleId: id } });
    if ((pModule.subModules?.length ?? 0) > 0 || screenCount > 0) {
      throw new ConflictException(ERROR_MESSAGES.MODULE_HAS_CHILDREN);
    }

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
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CreateActionDto,
  UpdateActionDto,
} from './dto/create-action.dto';

import { Action } from './entities/action.entity';
import { Screen } from '../screens/entities/screen.entity';
import { ACTIONS } from '../../bootstrap/seed-data';

@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);

  constructor(
    @InjectRepository(Action)
    private readonly actionRepository: Repository<Action>,

    @InjectRepository(Screen)
    private readonly screenRepository: Repository<Screen>,

  ) {}

  async create(dto: CreateActionDto) {


    if (dto.screenId) {
      const screen = await this.screenRepository.findOne({
        where: {
          id: dto.screenId,
        },
      });

      if (!screen) {
        throw new NotFoundException(
          'Screen not found',
        );
      }
    }

    if (dto.parentActionId) {
      await this.assertValidParent(dto.parentActionId, dto.screenId);
    }

    const exists = await this.actionRepository.findOne({
      where: [
        { name: dto.name },
        { code: dto.code },
      ],
    });

    if (exists) {
      throw new ConflictException(
        'Action already exists',
      );
    }

    const action =
      this.actionRepository.create(dto);

    return this.actionRepository.save(action);
  }

  private async assertValidParent(parentActionId: number, childScreenId?: number): Promise<void> {
    const parent = await this.actionRepository.findOne({ where: { id: parentActionId } });
    if (!parent) {
      throw new NotFoundException('Parent action not found');
    }
    if (parent.parentActionId != null) {
      throw new ConflictException('Nesting is limited to one level — a child action cannot itself be a parent');
    }
    if (childScreenId != null && parent.screenId !== childScreenId) {
      throw new ConflictException('Parent and child actions must belong to the same screen');
    }
  }

  async findAll() {
    return this.actionRepository.find({
      relations: {
        screen: true,
      },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        isActive: true,
        screenId: true,
      }
    });
  }

  async findOne(id: number) {
    const action =
      await this.actionRepository.findOne({
        where: {
          id,
        },
        relations: {
          screen: true,
        },
      });

    if (!action) {
      throw new NotFoundException(
        'Action not found',
      );
    }

    return action;
  }

  async update(
    id: number,
    dto: UpdateActionDto,
  ) {
    const action =
      await this.findOne(id);

    if (dto.parentActionId != null) {
      if (dto.parentActionId === id) {
        throw new ConflictException('An action cannot be its own parent');
      }
      await this.assertValidParent(dto.parentActionId, dto.screenId ?? action.screenId);
    }

    Object.assign(action, dto);

    return this.actionRepository.save(
      action,
    );
  }

  async remove(id: number) {
    const action =
      await this.findOne(id);

    await this.actionRepository.softRemove(
      action,
    );

    return {
      message:
        'Action deleted successfully',
    };
  }

  async ensureCriticalDefaults(): Promise<void> {
    const parentsByCode = new Map<string, Action>();

    for (const ac of ACTIONS.filter((a) => !a.parentActionCode)) {
      try {
        const parent = await this.ensureAction(ac);
        if (parent) parentsByCode.set(ac.code, parent);
      } catch (err) {
        this.logger.error(`Failed to backfill action "${ac.code}" — skipping`, err as Error);
      }
    }

    for (const ac of ACTIONS.filter((a) => a.parentActionCode)) {
      try {
        let parent = parentsByCode.get(ac.parentActionCode!);
        if (!parent) {
          parent = (await this.actionRepository.findOne({ where: { code: ac.parentActionCode } })) ?? undefined;
        }
        if (!parent) {
          this.logger.warn(`Action "${ac.code}" skipped — parent action "${ac.parentActionCode}" not found`);
          continue;
        }
        await this.ensureAction(ac, parent.id);
      } catch (err) {
        this.logger.error(`Failed to backfill action "${ac.code}" — skipping`, err as Error);
      }
    }
  }

  private async ensureAction(ac: (typeof ACTIONS)[number], parentActionId?: number): Promise<Action | undefined> {
    const existing = await this.actionRepository.findOne({
      where: [{ code: ac.code }, { name: ac.name }],
    });

    if (existing) {
      const wantsParent = parentActionId ?? null;
      const needsCorrection =
        (existing.parentActionId ?? null) !== wantsParent ||
        (ac.displayOrder != null && existing.displayOrder !== ac.displayOrder);
      if (needsCorrection) {
        existing.parentActionId = wantsParent;
        if (ac.displayOrder != null) existing.displayOrder = ac.displayOrder;
        await this.actionRepository.save(existing);
        this.logger.debug(`Corrected action "${ac.code}" (parent/displayOrder)`);
      }
      return existing;
    }

    const screen = await this.screenRepository.findOne({ where: { code: ac.screenCode } });
    if (!screen) {
      this.logger.warn(`Action "${ac.code}" skipped — Screen "${ac.screenCode}" not found`);
      return undefined;
    }

    const entity = this.actionRepository.create({
      screenId: screen.id,
      name: ac.name,
      code: ac.code,
      description: ac.description,
      isActive: true,
      parentActionId: parentActionId ?? null,
      displayOrder: ac.displayOrder ?? 0,
    });
    const saved = await this.actionRepository.save(entity);
    this.logger.debug(`Backfilled action "${ac.code}"`);
    return saved;
  }
}
import {
  ConflictException,
  Injectable,
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

@Injectable()
export class ActionsService {
  constructor(
    @InjectRepository(Action)
    private readonly actionRepository: Repository<Action>,

    @InjectRepository(Screen)
    private readonly screenRepository: Repository<Screen>,

  ) {}

  async create(dto: CreateActionDto) {
    if (!dto.screenId && !dto.tabId) {
      throw new ConflictException(
        'Screen or Tab is required',
      );
    }

    if (dto.screenId && dto.tabId) {
      throw new ConflictException(
        'Action can belong either to Screen or Tab',
      );
    }

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
        // screen: {
        //   id: true,
        //   name: true,
        // },
        // tab: {
        //   id: true,
        //   name: true,
        // },
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
}
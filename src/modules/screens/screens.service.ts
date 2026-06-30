import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { paginate } from '@app/common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

import { Screen } from './entities/screen.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';

import {
  CreateScreenDto,
  UpdateScreenDto,
} from './dto/create-screen.dto';

@Injectable()
export class ScreensService {
  constructor(
    @InjectRepository(Screen)
    private readonly screenRepository: Repository<Screen>,

    @InjectRepository(SubModule)
    private readonly subModuleRepository: Repository<SubModule>,
  ) {}

async create(dto: CreateScreenDto) {
  const subModule =
    await this.subModuleRepository.findOne({
      where: {
        id: dto.subModuleId,
      },
    });

  if (!subModule) {
    throw new NotFoundException(
      'Sub module not found',
    );
  }

  const screen =
    this.screenRepository.create(dto);

  return this.screenRepository.save(
    screen,
  );
}

async findAll() {
  return this.screenRepository.find({
    relations: {
      subModule: true,
    },
    select: {
      id: true,
      name: true,
      url: true,
      displayOrder: true,
      isActive: true,
      subModuleId: true,
      code:true,
      subModule: {
        id: true,
        name: true,
      },
    },
    order: {
      displayOrder: 'ASC',
    },
  });
}
  async findOne(id: number) {
    const screen =
      await this.screenRepository.findOne({
        where: {
          id,
        },
        relations: [
          'subModule',
        ],
      });

    if (!screen) {
      throw new NotFoundException(
        'Screen not found',
      );
    }

    return screen;
  }

  async update(
    id: number,
    dto: UpdateScreenDto,
  ) {
    const screen =
      await this.findOne(id);

    if (
      dto.subModuleId &&
      dto.subModuleId !==
        screen.subModuleId
    ) {
      const subModule =
        await this.subModuleRepository.findOne({
          where: {
            id: dto.subModuleId,
          },
        });

      if (!subModule) {
        throw new NotFoundException(
          'Sub module not found',
        );
      }
    }

    Object.assign(screen, dto);

    return this.screenRepository.save(
      screen,
    );
  }

  async remove(id: number) {
    const screen =
      await this.findOne(id);

    await this.screenRepository.softRemove(
      screen,
    );

    return {
      message:
        'Screen deleted successfully',
    };
  }
}
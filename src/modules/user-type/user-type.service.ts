import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { paginate } from '@app/common/utils/pagination.util';
import { PaginationQueryDto } from '@app/common/dto/pagination-query.dto';

import { CreateUserTypeDto, UpdateUserTypeDto } from './dto/create-user-type.dto';
import { UserType } from './entities/user-type.entity';

@Injectable()
export class UserTypeService {
  constructor(
    @InjectRepository(UserType)
    private readonly userTypeRepository: Repository<UserType>,
  ) { }

  async create(
    dto: CreateUserTypeDto,
  ) {
    const exists =
      await this.userTypeRepository.findOne({
        where: {
          name: dto.name,
        },
      });

    if (exists) {
      throw new ConflictException(
        'User type already exists',
      );
    }

    const userType =
      this.userTypeRepository.create({
        name: dto.name,
        description:
          dto.description,
        isActive:
          dto.isActive ?? true,
      });

    return this.userTypeRepository.save(
      userType,
    );
  }

  async findAll() {
    return this.userTypeRepository.find({
      select: {
        id: true,
        name: true,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  async findOne(id: number) {
    const userType =
      await this.userTypeRepository.findOne({
        where: {
          id,
        },
      });

    if (!userType) {
      throw new NotFoundException(
        'User type not found',
      );
    }

    return userType;
  }

  async update(
    id: number,
    dto: UpdateUserTypeDto,
  ) {
    const userType =
      await this.findOne(id);

    if (
      dto.name &&
      dto.name !== userType.name
    ) {
      const exists =
        await this.userTypeRepository.findOne({
          where: {
            name: dto.name,
          },
        });

      if (exists) {
        throw new ConflictException(
          'User type already exists',
        );
      }
    }

    Object.assign(
      userType,
      dto,
    );

    return this.userTypeRepository.save(
      userType,
    );
  }

  async remove(id: number) {
    const userType =
      await this.findOne(id);

    await this.userTypeRepository.softRemove(
      userType,
    );

    return {
      message:
        'User type deleted successfully',
    };
  }
}
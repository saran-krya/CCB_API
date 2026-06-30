import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PModule } from './entities/pmodule.entity';

import {
  CreatePModuleDto,
  UpdatePModuleDto,
} from './dto/create-pmodule.dto';


@Injectable()
export class PModulesService {
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
}
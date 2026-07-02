import {
  BadRequestException,
  Injectable,
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

@Injectable()
export class ScreensService {
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
}

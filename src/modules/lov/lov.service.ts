import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CreateLovDto, UpdateLovDto } from './dto/lov.dto';
import { LovCategory } from './entities/lov-category.entity';
import { LovValue } from './entities/lov-value.entity';

const LOV_SEED: { category: string; code: string; label: string; displayOrder: number }[] = [
  { category: 'BILLING_FREQUENCY', code: 'monthly',   label: 'Monthly',   displayOrder: 1 },
  { category: 'BILLING_FREQUENCY', code: 'quarterly', label: 'Quarterly', displayOrder: 2 },
  { category: 'BILLING_FREQUENCY', code: 'annually',  label: 'Annually',  displayOrder: 3 },
  { category: 'USER_CATEGORY',     code: 'internal',  label: 'Internal',  displayOrder: 1 },
  { category: 'USER_CATEGORY',     code: 'external',  label: 'External',  displayOrder: 2 },
  { category: 'USER_TYPE',         code: 'employee',  label: 'Employee',  displayOrder: 1 },
  { category: 'USER_TYPE',         code: 'customer',  label: 'Customer',  displayOrder: 2 },
];

@Injectable()
export class LovService {
  constructor(
    @InjectRepository(LovValue)
    private readonly lovValues: Repository<LovValue>,
    @InjectRepository(LovCategory)
    private readonly lovCategories: Repository<LovCategory>,
  ) {}

  async findCategories(): Promise<string[]> {
    const rows = await this.lovValues
      .createQueryBuilder('lv')
      .select('DISTINCT lv.category', 'category')
      .orderBy('lv.category', 'ASC')
      .getRawMany<{ category: string }>();
    return rows.map((r) => r.category);
  }

  async findByCategory(category: string, includeInactive = false): Promise<LovValue[]> {
    return this.lovValues.find({
      where: includeInactive ? { category } : { category, isActive: true },
      order: { displayOrder: 'ASC', code: 'ASC' },
    });
  }

  async findAll(): Promise<LovValue[]> {
    return this.lovValues.find({ order: { category: 'ASC', displayOrder: 'ASC' } });
  }

  async findCategoryModules(): Promise<Record<string, string | null>> {
    const rows = await this.lovCategories.find();
    const map: Record<string, string | null> = {};
    for (const row of rows) map[row.category] = row.module;
    return map;
  }

  async setCategoryModule(category: string, module: string | null | undefined): Promise<LovCategory> {
    let entity = await this.lovCategories.findOne({ where: { category } });
    if (!entity) {
      entity = this.lovCategories.create({ category, module: module ?? null });
    } else {
      entity.module = module ?? null;
    }
    return this.lovCategories.save(entity);
  }

  async create(dto: CreateLovDto): Promise<LovValue> {
    const existing = await this.lovValues.findOne({
      where: { category: dto.category, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `LOV value with code "${dto.code}" already exists in category "${dto.category}"`,
      );
    }
    const { module, ...rest } = dto;
    const entity = this.lovValues.create({ ...rest, isActive: dto.isActive ?? true });
    const saved = await this.lovValues.save(entity);

    if (module !== undefined) {
      await this.setCategoryModule(dto.category, module);
    }

    return saved;
  }

  async update(id: number, dto: UpdateLovDto): Promise<LovValue> {
    const entity = await this.lovValues.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`LOV value #${id} not found`);

    if (dto.code && dto.code !== entity.code) {
      const conflict = await this.lovValues.findOne({
        where: { category: dto.category ?? entity.category, code: dto.code },
      });
      if (conflict) {
        throw new ConflictException(
          `LOV value with code "${dto.code}" already exists in this category`,
        );
      }
    }

    Object.assign(entity, dto);
    return this.lovValues.save(entity);
  }

  async remove(id: number): Promise<void> {
    const entity = await this.lovValues.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`LOV value #${id} not found`);
    await this.lovValues.softRemove(entity);
  }

  async seedValues(manager: EntityManager): Promise<Map<string, number>> {
    const idMap = new Map<string, number>()
    for (const v of LOV_SEED) {
      const entity = manager.create(LovValue, { ...v, isActive: true });
      const saved = await manager.save(LovValue, entity);
      idMap.set(`${v.category}:${v.code}`, saved.id)
    }
    return idMap
  }
}

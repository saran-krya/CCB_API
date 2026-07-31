import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CreateLovDto, UpdateLovDto } from './dto/lov.dto';
import { LovCategory } from './entities/lov-category.entity';
import { LovValue } from './entities/lov-value.entity';

const LOV_SEED: {
  category: string;
  code: string;
  label: string;
  displayOrder: number;
  direction?: string;
  localeCode?: string;
  isSystem?: boolean;
}[] = [
  { category: 'BILLING_FREQUENCY', code: 'monthly',   label: 'Monthly',   displayOrder: 1 },
  { category: 'BILLING_FREQUENCY', code: 'quarterly', label: 'Quarterly', displayOrder: 2 },
  { category: 'BILLING_FREQUENCY', code: 'annually',  label: 'Annually',  displayOrder: 3 },
  { category: 'USER_CATEGORY',     code: 'internal',  label: 'Internal',  displayOrder: 1 },
  { category: 'USER_CATEGORY',     code: 'external',  label: 'External',  displayOrder: 2 },
  { category: 'USER_TYPE',         code: 'employee',  label: 'Employee',  displayOrder: 1 },
  { category: 'USER_TYPE',         code: 'customer',  label: 'Customer',  displayOrder: 2 },
  { category: 'TARIFF_UNIT_TYPE',  code: 'residential', label: 'Residential', displayOrder: 1 },
  { category: 'TARIFF_UNIT_TYPE',  code: 'commercial',  label: 'Commercial',  displayOrder: 2 },
  { category: 'TARIFF_REJECTION_REASON', code: 'incomplete',     label: 'Incomplete Information',      displayOrder: 1 },
  { category: 'TARIFF_REJECTION_REASON', code: 'rate-incorrect', label: 'Rate Configuration Incorrect', displayOrder: 2 },
  { category: 'TARIFF_REJECTION_REASON', code: 'applicability',  label: 'Applicability Scope Issue',    displayOrder: 3 },
  { category: 'TARIFF_REJECTION_REASON', code: 'scope',          label: 'Scope Reduction Conflict',     displayOrder: 4 },
  { category: 'TARIFF_REJECTION_REASON', code: 'other',          label: 'Other',                        displayOrder: 5 },
  { category: 'BILLING_CYCLE_CHANGE_REASON', code: 'dewa-realign',        label: 'DEWA Billing Realignment',        displayOrder: 1 },
  { category: 'BILLING_CYCLE_CHANGE_REASON', code: 'building-handover',   label: 'Building Handover',                displayOrder: 2 },
  { category: 'BILLING_CYCLE_CHANGE_REASON', code: 'finance-period',      label: 'Finance Period Change',            displayOrder: 3 },
  { category: 'BILLING_CYCLE_CHANGE_REASON', code: 'correction',          label: 'Data Correction',                  displayOrder: 4 },
  { category: 'BILLING_CYCLE_CHANGE_REASON', code: 'operational',         label: 'Operational Requirement',          displayOrder: 5 },
  { category: 'BILLING_CYCLE_CHANGE_REASON', code: 'regulatory',          label: 'Regulatory Requirement',           displayOrder: 6 },
  { category: 'BILLING_CYCLE_CHANGE_REASON', code: 'other',               label: 'Other',                            displayOrder: 7 },
  { category: 'BILLING_CYCLE_DEPRECATION_REASON', code: 'dewa-realign',          label: 'DEWA Billing Realignment',    displayOrder: 1 },
  { category: 'BILLING_CYCLE_DEPRECATION_REASON', code: 'building-decommission', label: 'Building Decommissioned',     displayOrder: 2 },
  { category: 'BILLING_CYCLE_DEPRECATION_REASON', code: 'replaced-by-new-version', label: 'Replaced by New Version',   displayOrder: 3 },
  { category: 'BILLING_CYCLE_DEPRECATION_REASON', code: 'regulatory',            label: 'Regulatory Requirement',      displayOrder: 4 },
  { category: 'BILLING_CYCLE_DEPRECATION_REASON', code: 'other',                 label: 'Other',                       displayOrder: 5 },
  { category: 'LANGUAGE', code: 'en', label: 'English',  displayOrder: 1, direction: 'ltr', localeCode: 'en-US', isSystem: true },
  { category: 'LANGUAGE', code: 'ar', label: 'العربية', displayOrder: 2, direction: 'rtl', localeCode: 'ar-AE', isSystem: true },
];

const LOV_CATEGORY_MODULES: Record<string, string> = {
  BILLING_FREQUENCY: 'billing-cycle',      // Billing Cycle Configuration
  USER_CATEGORY: 'user-management',
  USER_TYPE: 'user-management',
  TARIFF_UNIT_TYPE: 'tariff',              // Tariff Configuration
  TARIFF_REJECTION_REASON: 'tariff',
  BILLING_CYCLE_CHANGE_REASON: 'billing-cycle',
  BILLING_CYCLE_DEPRECATION_REASON: 'billing-cycle',
};

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

  async findActiveLanguages(): Promise<LovValue[]> {
    return this.findByCategory('LANGUAGE', false);
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

    if (entity.isSystem) {
      const attemptsContentChange =
        (dto.code !== undefined && dto.code !== entity.code) ||
        (dto.label !== undefined && dto.label !== entity.label);
      if (attemptsContentChange) {
        throw new ConflictException('System-defined values cannot be renamed or recoded');
      }
    }

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
    if (entity.isSystem) {
      throw new ConflictException('System-defined values cannot be deleted');
    }
    await this.lovValues.softRemove(entity);
  }

  async ensureCriticalDefaults(): Promise<void> {
    const criticalCategories = [
      'TARIFF_UNIT_TYPE',
      'TARIFF_REJECTION_REASON',
      'BILLING_CYCLE_CHANGE_REASON',
      'BILLING_CYCLE_DEPRECATION_REASON',
      'LANGUAGE',
    ];
    for (const category of criticalCategories) {
      const existing = await this.lovValues.count({ where: { category } });
      if (existing > 0) continue;

      for (const seed of LOV_SEED.filter((v) => v.category === category)) {
        await this.lovValues.save(this.lovValues.create({ ...seed, isActive: true }));
      }
      const module = LOV_CATEGORY_MODULES[category];
      if (module) await this.setCategoryModule(category, module);
    }

    await this.correctSystemFlags();
  }

  private async correctSystemFlags(): Promise<void> {
    for (const seed of LOV_SEED.filter((v) => v.isSystem)) {
      const existing = await this.lovValues.findOne({
        where: { category: seed.category, code: seed.code },
      });
      if (existing && !existing.isSystem) {
        existing.isSystem = true;
        await this.lovValues.save(existing);
      }
    }
  }

  async seedValues(manager: EntityManager): Promise<Map<string, number>> {
    const idMap = new Map<string, number>()
    for (const v of LOV_SEED) {
      const entity = manager.create(LovValue, { ...v, isActive: true });
      const saved = await manager.save(LovValue, entity);
      idMap.set(`${v.category}:${v.code}`, saved.id)
    }
    for (const [category, module] of Object.entries(LOV_CATEGORY_MODULES)) {
      const entity = manager.create(LovCategory, { category, module });
      await manager.save(LovCategory, entity);
    }
    return idMap
  }
}

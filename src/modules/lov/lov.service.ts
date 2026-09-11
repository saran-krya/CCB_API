import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CreateLovDto, UpdateLovDto } from './dto/lov.dto';
import { LovCategory } from './entities/lov-category.entity';
import { LovValue } from './entities/lov-value.entity';

// Nationality list — kept separate from the main LOV_SEED literal purely for readability given its
// size (~195 rows); merged into LOV_SEED below like every other category. Codes are ISO 3166-1
// alpha-2 country codes; labels are the nationality adjective (what a registration form displays),
// not the country name.
const NATIONALITY_SEED: {
  category: string;
  code: string;
  label: string;
  displayOrder: number;
}[] = [
  'Afghan|AF', 'Albanian|AL', 'Algerian|DZ', 'American|US', 'Andorran|AD', 'Angolan|AO',
  'Argentine|AR', 'Armenian|AM', 'Australian|AU', 'Austrian|AT', 'Azerbaijani|AZ', 'Bahamian|BS',
  'Bahraini|BH', 'Bangladeshi|BD', 'Barbadian|BB', 'Belarusian|BY', 'Belgian|BE', 'Belizean|BZ',
  'Beninese|BJ', 'Bhutanese|BT', 'Bolivian|BO', 'Bosnian|BA', 'Motswana|BW', 'Brazilian|BR',
  'Bruneian|BN', 'Bulgarian|BG', 'Burkinabe|BF', 'Burmese|MM', 'Burundian|BI', 'Cambodian|KH',
  'Cameroonian|CM', 'Canadian|CA', 'Cape Verdean|CV', 'Central African|CF', 'Chadian|TD',
  'Chilean|CL', 'Chinese|CN', 'Colombian|CO', 'Comoran|KM', 'Congolese|CG', 'Costa Rican|CR',
  'Croatian|HR', 'Cuban|CU', 'Cypriot|CY', 'Czech|CZ', 'Danish|DK', 'Djiboutian|DJ', 'Dominican|DO',
  'Dutch|NL', 'Timorese|TL', 'Ecuadorian|EC', 'Egyptian|EG', 'Emirati|AE', 'Salvadoran|SV',
  'Equatorial Guinean|GQ', 'Eritrean|ER', 'Estonian|EE', 'Ethiopian|ET', 'Fijian|FJ', 'Finnish|FI',
  'French|FR', 'Gabonese|GA', 'Gambian|GM', 'Georgian|GE', 'German|DE', 'Ghanaian|GH', 'Greek|GR',
  'Grenadian|GD', 'Guatemalan|GT', 'Guinean|GN', 'Bissau-Guinean|GW', 'Guyanese|GY', 'Haitian|HT',
  'Honduran|HN', 'Hungarian|HU', 'Icelandic|IS', 'Indian|IN', 'Indonesian|ID', 'Iranian|IR',
  'Iraqi|IQ', 'Irish|IE', 'Israeli|IL', 'Italian|IT', 'Ivorian|CI', 'Jamaican|JM', 'Japanese|JP',
  'Jordanian|JO', 'Kazakhstani|KZ', 'Kenyan|KE', 'I-Kiribati|KI', 'Kuwaiti|KW', 'Kyrgyzstani|KG',
  'Lao|LA', 'Latvian|LV', 'Lebanese|LB', 'Basotho|LS', 'Liberian|LR', 'Libyan|LY',
  'Liechtensteiner|LI', 'Lithuanian|LT', 'Luxembourgish|LU', 'Malagasy|MG', 'Malawian|MW',
  'Malaysian|MY', 'Maldivian|MV', 'Malian|ML', 'Maltese|MT', 'Marshallese|MH', 'Mauritanian|MR',
  'Mauritian|MU', 'Mexican|MX', 'Micronesian|FM', 'Moldovan|MD', 'Monacan|MC', 'Mongolian|MN',
  'Montenegrin|ME', 'Moroccan|MA', 'Mozambican|MZ', 'Namibian|NA', 'Nauruan|NR', 'Nepali|NP',
  'New Zealander|NZ', 'Nicaraguan|NI', 'Nigerien|NE', 'Nigerian|NG', 'North Korean|KP',
  'North Macedonian|MK', 'Norwegian|NO', 'Omani|OM', 'Pakistani|PK', 'Palauan|PW',
  'Palestinian|PS', 'Panamanian|PA', 'Papua New Guinean|PG', 'Paraguayan|PY', 'Peruvian|PE',
  'Filipino|PH', 'Polish|PL', 'Portuguese|PT', 'Qatari|QA', 'Romanian|RO', 'Russian|RU',
  'Rwandan|RW', 'Kittitian|KN', 'Saint Lucian|LC', 'Vincentian|VC', 'Samoan|WS', 'Sammarinese|SM',
  'Sao Tomean|ST', 'Saudi|SA', 'Senegalese|SN', 'Serbian|RS', 'Seychellois|SC', 'Sierra Leonean|SL',
  'Singaporean|SG', 'Slovak|SK', 'Slovenian|SI', 'Solomon Islander|SB', 'Somali|SO',
  'South African|ZA', 'South Korean|KR', 'South Sudanese|SS', 'Spanish|ES', 'Sri Lankan|LK',
  'Sudanese|SD', 'Surinamese|SR', 'Swazi|SZ', 'Swedish|SE', 'Swiss|CH', 'Syrian|SY',
  'Taiwanese|TW', 'Tajikistani|TJ', 'Tanzanian|TZ', 'Thai|TH', 'Togolese|TG', 'Tongan|TO',
  'Trinidadian|TT', 'Tunisian|TN', 'Turkish|TR', 'Turkmen|TM', 'Tuvaluan|TV', 'Ugandan|UG',
  'Ukrainian|UA', 'British|GB', 'Uruguayan|UY', 'Uzbekistani|UZ', 'Ni-Vanuatu|VU', 'Vatican|VA',
  'Venezuelan|VE', 'Vietnamese|VN', 'Yemeni|YE', 'Zambian|ZM', 'Zimbabwean|ZW',
].map((entry, i) => {
  const [label, code] = entry.split('|');
  return { category: 'NATIONALITY', code: code.toLowerCase(), label, displayOrder: i + 1 };
});

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

  { category: 'SALUTATION', code: 'mr', label: 'Mr', displayOrder: 1 },
  { category: 'SALUTATION', code: 'mrs', label: 'Mrs', displayOrder: 2 },
  { category: 'SALUTATION', code: 'ms', label: 'Ms', displayOrder: 3 },
  { category: 'SALUTATION', code: 'dr', label: 'Dr', displayOrder: 4 },

  { category: 'MARITAL_STATUS', code: 'single', label: 'Single', displayOrder: 1 },
  { category: 'MARITAL_STATUS', code: 'married', label: 'Married', displayOrder: 2 },
  { category: 'MARITAL_STATUS', code: 'divorced', label: 'Divorced', displayOrder: 3 },
  { category: 'MARITAL_STATUS', code: 'widowed', label: 'Widowed', displayOrder: 4 },

  { category: 'COMMUNICATION_CHANNEL', code: 'email', label: 'Email', displayOrder: 1 },
  { category: 'COMMUNICATION_CHANNEL', code: 'sms', label: 'SMS', displayOrder: 2 },
  { category: 'COMMUNICATION_CHANNEL', code: 'whatsapp', label: 'WhatsApp', displayOrder: 3 },
  { category: 'COMMUNICATION_CHANNEL', code: 'phone-call', label: 'Phone Call', displayOrder: 4 },

  { category: 'RELATIONSHIP', code: 'spouse', label: 'Spouse', displayOrder: 1 },
  { category: 'RELATIONSHIP', code: 'parent', label: 'Parent', displayOrder: 2 },
  { category: 'RELATIONSHIP', code: 'child', label: 'Child', displayOrder: 3 },
  { category: 'RELATIONSHIP', code: 'sibling', label: 'Sibling', displayOrder: 4 },
  { category: 'RELATIONSHIP', code: 'friend', label: 'Friend', displayOrder: 5 },
  { category: 'RELATIONSHIP', code: 'relative', label: 'Relative', displayOrder: 6 },
  { category: 'RELATIONSHIP', code: 'other', label: 'Other', displayOrder: 7 },

  { category: 'LEGAL_STRUCTURE', code: 'llc', label: 'LLC', displayOrder: 1 },
  { category: 'LEGAL_STRUCTURE', code: 'free-zone-company', label: 'Free Zone Company', displayOrder: 2 },
  { category: 'LEGAL_STRUCTURE', code: 'sole-establishment', label: 'Sole Establishment', displayOrder: 3 },
  { category: 'LEGAL_STRUCTURE', code: 'branch-of-foreign-company', label: 'Branch of Foreign Company', displayOrder: 4 },

  { category: 'PAYMENT_METHOD_TYPE', code: 'card', label: 'Card', displayOrder: 1 },
  { category: 'PAYMENT_METHOD_TYPE', code: 'direct-debit', label: 'Direct Debit', displayOrder: 2 },
  { category: 'PAYMENT_METHOD_TYPE', code: 'bank-transfer', label: 'Bank Transfer', displayOrder: 3 },
  { category: 'PAYMENT_METHOD_TYPE', code: 'cheque', label: 'Cheque', displayOrder: 4 },
  { category: 'PAYMENT_METHOD_TYPE', code: 'cash', label: 'Cash', displayOrder: 5 },
  { category: 'PAYMENT_METHOD_TYPE', code: 'online-portal', label: 'Online Portal', displayOrder: 6 },

  { category: 'GENDER', code: 'male', label: 'Male', displayOrder: 1 },
  { category: 'GENDER', code: 'female', label: 'Female', displayOrder: 2 },
  { category: 'GENDER', code: 'other', label: 'Other', displayOrder: 3 },

  { category: 'BILLING_TYPE', code: 'consolidated', label: 'Consolidated', displayOrder: 1 },
  { category: 'BILLING_TYPE', code: 'per-unit', label: 'Per Unit', displayOrder: 2 },

  ...NATIONALITY_SEED,
];

const LOV_CATEGORY_MODULES: Record<string, string> = {
  BILLING_FREQUENCY: 'billing-cycle',      // Billing Cycle Configuration
  USER_CATEGORY: 'user-management',
  USER_TYPE: 'user-management',
  TARIFF_UNIT_TYPE: 'tariff',              // Tariff Configuration
  TARIFF_REJECTION_REASON: 'tariff',
  BILLING_CYCLE_CHANGE_REASON: 'billing-cycle',
  BILLING_CYCLE_DEPRECATION_REASON: 'billing-cycle',
  SALUTATION: 'customer',                  // Registration Requests
  MARITAL_STATUS: 'customer',
  COMMUNICATION_CHANNEL: 'customer',
  RELATIONSHIP: 'customer',
  LEGAL_STRUCTURE: 'customer',
  PAYMENT_METHOD_TYPE: 'customer',
  GENDER: 'customer',
  NATIONALITY: 'customer',
  BILLING_TYPE: 'customer',
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
      'SALUTATION',
      'MARITAL_STATUS',
      'COMMUNICATION_CHANNEL',
      'RELATIONSHIP',
      'LEGAL_STRUCTURE',
      'PAYMENT_METHOD_TYPE',
      'GENDER',
      'NATIONALITY',
      'BILLING_TYPE',
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

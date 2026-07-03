import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { AttributeQueryDto, CreateAttributeDto, UpdateAttributeDto } from './dto/attribute.dto';
import { Attribute, AttributeScope, AttributeValueType } from './entities/attribute.entity';

// Parameters where a value change is required to carry a reason — these feed
// business rules tied to active billing cycles / bill runs. There is no
// deferred-activation engine yet (Bill Generation doesn't exist in this
// codebase), so this is the real, enforceable slice of "switching restriction
// rules" today: an auditable reason instead of a silent overwrite.
const CYCLE_SENSITIVE_KEYS = new Set([
  'VAT_RATE',
  'SUPER_ADMIN_REVOKE_AFTER_CYCLE_CLOSE',
  'SUPER_ADMIN_FORCE_TARIFF_ACTIVATION',
  'FINANCE_OVERRIDE_VALIDATION_AT_BILL_RUN',
]);

type AttributeSeedRow = Pick<Attribute, 'scope' | 'key' | 'label' | 'valueType' | 'value' | 'displayOrder'> &
  Partial<
    Pick<
      Attribute,
      | 'module'
      | 'groupKey'
      | 'groupLabel'
      | 'groupDescription'
      | 'description'
      | 'trueLabel'
      | 'falseLabel'
      | 'unit'
      | 'editable'
    >
  >;

function buildAttributeSeed(sessionTimeoutMinutes: number): AttributeSeedRow[] {
  const portalGroup = {
    module: 'customer',
    groupKey: 'portal_and_access',
    groupLabel: 'Portal and Access',
    groupDescription: 'Customer portal access controls, payment options, and authentication requirements',
  };

  return [
    // ── System Attributes ──────────────────────────────────────────────────
    {
      scope: AttributeScope.SYSTEM, key: 'DEFAULT_CURRENCY', label: 'Default Currency',
      description: 'Fixed for UAE', valueType: AttributeValueType.TEXT, value: 'AED',
      editable: false, displayOrder: 1,
    },
    {
      scope: AttributeScope.SYSTEM, key: 'VAT_RATE', label: 'VAT Rate',
      description: 'UAE FTA standard', valueType: AttributeValueType.NUMBER, value: '5',
      unit: '%', displayOrder: 2,
    },
    {
      scope: AttributeScope.SYSTEM, key: 'SECURITY_DEPOSIT_VAT', label: 'Security Deposit VAT',
      description: 'UAE FTA regulation', valueType: AttributeValueType.TEXT, value: 'Always exempt',
      editable: false, displayOrder: 3,
    },
    {
      scope: AttributeScope.SYSTEM, key: 'SUPER_ADMIN_REVOKE_AFTER_CYCLE_CLOSE',
      label: 'Super Admin Revoke After Cycle Close', valueType: AttributeValueType.BOOLEAN, value: 'true',
      trueLabel: 'Allowed with justification', falseLabel: 'Blocked', displayOrder: 4,
    },
    {
      scope: AttributeScope.SYSTEM, key: 'SUPER_ADMIN_FORCE_TARIFF_ACTIVATION',
      label: 'Super Admin Force Tariff Activation', valueType: AttributeValueType.BOOLEAN, value: 'true',
      trueLabel: 'Allowed with justification', falseLabel: 'Blocked', displayOrder: 5,
    },
    {
      scope: AttributeScope.SYSTEM, key: 'FINANCE_OVERRIDE_VALIDATION_AT_BILL_RUN',
      label: 'Finance Can Override Validation at Bill Run', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 6,
    },
    {
      scope: AttributeScope.SYSTEM, key: 'SESSION_TIMEOUT_MINUTES', label: 'Session Timeout (minutes)',
      description: 'Controls how long a login session stays active before requiring re-authentication',
      valueType: AttributeValueType.NUMBER, value: String(sessionTimeoutMinutes), unit: 'minutes', displayOrder: 7,
    },

    // ── Module Attributes: Customer Management → Portal and Access ─────────
    {
      ...portalGroup, scope: AttributeScope.MODULE, key: 'CUSTOMER_PORTAL_ACCESS',
      label: 'Customer Portal Access', valueType: AttributeValueType.BOOLEAN, value: 'true',
      trueLabel: 'Enabled', falseLabel: 'Disabled', displayOrder: 1,
    },
    {
      ...portalGroup, scope: AttributeScope.MODULE, key: 'SELF_SERVICE_PAYMENT',
      label: 'Self-Service Payment', valueType: AttributeValueType.BOOLEAN, value: 'true',
      trueLabel: 'Enabled', falseLabel: 'Disabled', displayOrder: 2,
    },
    {
      ...portalGroup, scope: AttributeScope.MODULE, key: 'DISPUTE_AUTO_ACK_HOURS',
      label: 'Dispute Auto-Acknowledgement Hours', valueType: AttributeValueType.NUMBER, value: '24',
      unit: 'hours', displayOrder: 3,
    },
    {
      ...portalGroup, scope: AttributeScope.MODULE, key: 'UAE_PASS_AUTHENTICATION',
      label: 'UAE PASS Authentication', valueType: AttributeValueType.BOOLEAN, value: 'true',
      trueLabel: 'Required', falseLabel: 'Optional', displayOrder: 4,
    },
  ];
}

function parseExpiryToMinutes(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 60;
  const value = parseInt(match[1], 10);
  const toMinutes: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 1440 };
  return Math.max(1, Math.round(value * toMinutes[match[2]]));
}

@Injectable()
export class AttributeService {
  constructor(
    @InjectRepository(Attribute)
    private readonly attributes: Repository<Attribute>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async findAll(query: AttributeQueryDto) {
    const { scope, module, groupKey, search } = query;

    const qb = this.attributes
      .createQueryBuilder('a')
      .orderBy('a.displayOrder', 'ASC')
      .addOrderBy('a.label', 'ASC');

    if (scope) qb.andWhere('a.scope = :scope', { scope });
    if (module) qb.andWhere('a.module = :module', { module });
    if (groupKey) qb.andWhere('a.group_key = :groupKey', { groupKey });
    if (search) {
      qb.andWhere('(a.label LIKE :s OR a.key LIKE :s OR a.description LIKE :s)', { s: `%${search}%` });
    }

    if (scope === AttributeScope.MODULE) {
      // Module Attributes render as cards, not a paginated table — fetch everything.
      const items = await qb.getMany();
      return { items, pagination: { page: 1, limit: items.length || 1, total: items.length, totalPages: 1 } };
    }

    return paginate(qb, query);
  }

  async findOne(id: number): Promise<Attribute> {
    const attribute = await this.attributes.findOne({ where: { id } });
    if (!attribute) throw new NotFoundException('Attribute not found');
    return attribute;
  }

  async getValueByKey(key: string): Promise<string | null> {
    const attribute = await this.attributes.findOne({ where: { key } });
    return attribute?.value ?? null;
  }

  async create(dto: CreateAttributeDto, actorId?: number): Promise<Attribute> {
    const existing = await this.attributes.findOne({
      where: {
        scope: dto.scope,
        module: dto.module ?? IsNull(),
        groupKey: dto.groupKey ?? IsNull(),
        key: dto.key,
      },
    });
    if (existing) {
      throw new ConflictException(`Attribute "${dto.key}" already exists in this scope/module/group`);
    }

    const entity = this.attributes.create({
      ...dto,
      module: dto.module ?? null,
      groupKey: dto.groupKey ?? null,
      groupLabel: dto.groupLabel ?? null,
      groupDescription: dto.groupDescription ?? null,
      description: dto.description ?? null,
      trueLabel: dto.trueLabel ?? null,
      falseLabel: dto.falseLabel ?? null,
      unit: dto.unit ?? null,
      editable: dto.editable ?? true,
      displayOrder: dto.displayOrder ?? 1,
      isSystemDefined: false,
    });
    const saved = await this.attributes.save(entity);

    await this.audit.record({
      moduleName: 'attributes',
      entityId: saved.id,
      action: 'CREATE',
      newValue: { key: saved.key, scope: saved.scope, module: saved.module, value: saved.value },
      performedBy: actorId,
    });

    return saved;
  }

  async update(id: number, dto: UpdateAttributeDto, actorId?: number): Promise<Attribute> {
    const attribute = await this.attributes.findOne({ where: { id } });
    if (!attribute) throw new NotFoundException('Attribute not found');

    const { changeReason, ...fields } = dto;

    if (!attribute.editable && fields.value !== undefined && fields.value !== attribute.value) {
      throw new ConflictException(`"${attribute.label}" is not editable`);
    }

    if (CYCLE_SENSITIVE_KEYS.has(attribute.key) && fields.value !== undefined && !changeReason?.trim()) {
      throw new ConflictException('A reason for change is required for this parameter');
    }

    const oldValue = { value: attribute.value, editable: attribute.editable };
    Object.assign(attribute, fields);
    const saved = await this.attributes.save(attribute);

    await this.audit.record({
      moduleName: 'attributes',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: { ...fields, changeReason },
      performedBy: actorId,
    });

    return saved;
  }

  async remove(id: number, actorId?: number): Promise<{ deleted: boolean }> {
    const attribute = await this.attributes.findOne({ where: { id } });
    if (!attribute) throw new NotFoundException('Attribute not found');
    if (attribute.isSystemDefined) {
      throw new ConflictException('System-defined attributes cannot be deleted');
    }

    await this.attributes.softRemove(attribute);

    await this.audit.record({
      moduleName: 'attributes',
      entityId: id,
      action: 'DELETE',
      oldValue: { key: attribute.key, scope: attribute.scope, module: attribute.module },
      performedBy: actorId,
    });

    return { deleted: true };
  }

  async seedValues(manager: EntityManager): Promise<void> {
    const jwtExpiresIn = this.config.get<string>('JWT_EXPIRES_IN', '60m');
    const sessionTimeoutMinutes = parseExpiryToMinutes(jwtExpiresIn);

    for (const row of buildAttributeSeed(sessionTimeoutMinutes)) {
      const entity = manager.create(Attribute, {
        module: null,
        groupKey: null,
        groupLabel: null,
        groupDescription: null,
        description: null,
        trueLabel: null,
        falseLabel: null,
        unit: null,
        editable: true,
        isSystemDefined: true,
        ...row,
      });
      await manager.save(Attribute, entity);
    }
  }
}

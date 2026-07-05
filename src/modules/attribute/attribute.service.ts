import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { ROLES } from '../../common/constants/global';
import { paginate } from '../../common/utils/pagination.util';
import { AttributeQueryDto, attributeValueErrorMessage, isValueValidForType, UpdateAttributeDto } from './dto/attribute.dto';
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

// Key-specific bounds, on top of the generic type validation below. Kept as a
// narrow, explicit lookup (not a generic min/max column on Attribute) since
// Session Timeout is the only General Attribute implemented so far.
const ATTRIBUTE_BOUNDS: Record<string, { min: number; max: number }> = {
  SESSION_TIMEOUT_MINUTES: { min: 30, max: 1440 }, // 30 minutes to 24 hours
};

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

  const userManagementGroup = {
    module: 'user-management',
    groupKey: 'user_creation_rules',
    groupLabel: 'User Creation Rules',
    groupDescription: 'Field requirements applied when creating or editing users',
  };

  const roleManagementGroup = {
    module: 'role-management',
    groupKey: 'permission_management_rules',
    groupLabel: 'Permission Management Rules',
    groupDescription: 'Behavior controls for the role permission tree editor',
  };

  const billingCycleGroup = {
    module: 'billing-cycle',
    groupKey: 'billing_cycle_rules',
    groupLabel: 'Billing Cycle Rules',
    groupDescription: 'Default behavior and change controls for billing cycle records',
  };

  return [
    // ── General Attributes ──────────────────────────────────────────────────
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

    // ── Module Attributes: User Management → User Creation Rules ───────────
    {
      ...userManagementGroup, scope: AttributeScope.MODULE, key: 'REPORTING_MANAGER_MANDATORY',
      label: 'Reporting Manager Mandatory', valueType: AttributeValueType.BOOLEAN, value: 'false',
      description: 'Whether a Reporting Manager must be selected when creating a user',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 1,
    },

    // ── Module Attributes: Role Management → Permission Management Rules ───
    {
      ...roleManagementGroup, scope: AttributeScope.MODULE, key: 'PERMISSION_TREE_CASCADE_ENABLED',
      label: 'Permission Tree Cascade', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether checking a module/sub-module in the permission tree auto-selects everything beneath it',
      trueLabel: 'Cascade to Children', falseLabel: 'Explicit Selection Only', displayOrder: 1,
    },

    // ── Module Attributes: Billing Cycle Configuration → Billing Cycle Rules ─
    {
      ...billingCycleGroup, scope: AttributeScope.MODULE, key: 'REQUIRE_CHANGE_REASON_ON_EDIT',
      label: 'Require Change Reason on Edit', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether a reason is mandatory when saving changes to an existing billing cycle',
      trueLabel: 'Required', falseLabel: 'Optional', displayOrder: 1,
    },
  ];
}

// Keys that used to be seeded but have since been retired — pruned from
// already-initialized databases on the next bootstrap so a removed attribute
// doesn't linger just because seedValues() only ever inserts, never deletes.
const RETIRED_ATTRIBUTE_KEYS = ['DEFAULT_CYCLE_STATUS_ACTIVE'];

@Injectable()
export class AttributeService {
  constructor(
    @InjectRepository(Attribute)
    private readonly attributes: Repository<Attribute>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async findAll(query: AttributeQueryDto) {
    const { scope, module, groupKey, key, search } = query;

    const qb = this.attributes
      .createQueryBuilder('a')
      .orderBy('a.displayOrder', 'ASC')
      .addOrderBy('a.label', 'ASC');

    if (scope) qb.andWhere('a.scope = :scope', { scope });
    if (module) qb.andWhere('a.module = :module', { module });
    if (groupKey) qb.andWhere('a.group_key = :groupKey', { groupKey });
    if (key) qb.andWhere('a.key = :key', { key });
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

  async update(id: number, dto: UpdateAttributeDto, actorId?: number, actorRoleName?: string): Promise<Attribute> {
    const attribute = await this.attributes.findOne({ where: { id } });
    if (!attribute) throw new NotFoundException('Attribute not found');

    if (attribute.scope === AttributeScope.SYSTEM && actorRoleName !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('Only Super Admin can edit General Attributes');
    }

    const { changeReason, ...fields } = dto;

    if (!attribute.editable && fields.value !== undefined && fields.value !== attribute.value) {
      throw new ConflictException(`"${attribute.label}" is not editable`);
    }

    if (fields.value !== undefined && !isValueValidForType(fields.value, attribute.valueType)) {
      throw new BadRequestException(attributeValueErrorMessage(attribute.valueType));
    }

    const bounds = ATTRIBUTE_BOUNDS[attribute.key];
    if (bounds && fields.value !== undefined) {
      const numeric = Number(fields.value);
      if (numeric < bounds.min || numeric > bounds.max) {
        throw new BadRequestException(
          `"${attribute.label}" must be between ${bounds.min} and ${bounds.max}${attribute.unit ? ` ${attribute.unit}` : ''}`,
        );
      }
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

  async seedValues(manager: EntityManager): Promise<void> {
    const sessionTimeoutMinutes = this.config.get<number>('SESSION_TIMEOUT_MINUTES', 30);

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

  // Self-heals databases that were initialized before a given General
  // Attribute existed in buildAttributeSeed() — e.g. Session Timeout, added
  // after this deployment's users table was already populated, so the
  // one-time bootstrap seed (seedValues, above) never ran again to pick it
  // up. Only called for the "database already initialized" branch of
  // bootstrap — a fresh database gets this key from seedValues() instead, so
  // calling both would insert a duplicate row.
  async ensureCriticalDefaults(): Promise<void> {
    const criticalKeys = [
      'SESSION_TIMEOUT_MINUTES',
      'REPORTING_MANAGER_MANDATORY',
      'PERMISSION_TREE_CASCADE_ENABLED',
      'REQUIRE_CHANGE_REASON_ON_EDIT',
    ];

    await this.attributes.delete({ key: In(RETIRED_ATTRIBUTE_KEYS) });

    const sessionTimeoutMinutes = this.config.get<number>('SESSION_TIMEOUT_MINUTES', 30);
    const seedRows = buildAttributeSeed(sessionTimeoutMinutes);

    for (const key of criticalKeys) {
      const exists = await this.attributes.findOne({ where: { key } });
      if (exists) continue;

      const seedRow = seedRows.find((r) => r.key === key);
      if (!seedRow) continue;

      const entity = this.attributes.create({
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
        ...seedRow,
      });
      await this.attributes.save(entity);
    }
  }
}

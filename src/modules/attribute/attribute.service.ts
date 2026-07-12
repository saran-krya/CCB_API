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

  const tariffGroup = {
    module: 'tariff',
    groupKey: 'tariff_config_rules',
    groupLabel: 'Tariff Configuration Rules',
    groupDescription: 'Defaults and guardrails applied to the tariff creation, approval, and versioning workflow',
  };

  const meterImportGroup = {
    module: 'meter',
    groupKey: 'meter_bulk_import',
    groupLabel: 'Bulk Import',
    groupDescription: 'Approval thresholds and column configuration for Master Meter and Sub Meter bulk import/export',
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
    {
      ...billingCycleGroup, scope: AttributeScope.MODULE, key: 'BILLING_CYCLE_DEFAULT_BILL_GENERATION_DAYS',
      label: 'Default Bill Generation Days', valueType: AttributeValueType.NUMBER, value: '3',
      description: 'Days after reading end pre-filled on the create-cycle form for when a bill is generated internally',
      unit: 'days', displayOrder: 2,
    },
    {
      ...billingCycleGroup, scope: AttributeScope.MODULE, key: 'BILLING_CYCLE_DEFAULT_BILL_ISSUE_DAYS',
      label: 'Default Bill Issue Days', valueType: AttributeValueType.NUMBER, value: '7',
      description: 'Days after reading end pre-filled on the create-cycle form for when a bill is issued to the customer',
      unit: 'days', displayOrder: 3,
    },
    {
      ...billingCycleGroup, scope: AttributeScope.MODULE, key: 'BILLING_CYCLE_DEFAULT_BILL_DUE_DAYS',
      label: 'Default Payment Due Days', valueType: AttributeValueType.NUMBER, value: '14',
      description: 'Days after bill issue pre-filled on the create-cycle form for when payment is due',
      unit: 'days', displayOrder: 4,
    },

    // ── Module Attributes: Tariff Configuration → Tariff Configuration Rules ─
    {
      ...tariffGroup, scope: AttributeScope.MODULE, key: 'TARIFF_DEFAULT_VAT_RATE',
      label: 'Default VAT Rate', valueType: AttributeValueType.NUMBER, value: '5',
      description: 'VAT percentage pre-filled on a new tariff when none is specified',
      unit: '%', displayOrder: 1,
    },
    {
      ...tariffGroup, scope: AttributeScope.MODULE, key: 'TARIFF_APPROVAL_SLA_HOURS',
      label: 'Finance Approval SLA', valueType: AttributeValueType.NUMBER, value: '48',
      description: 'Target turnaround time shown to submitters for how long Finance review should take',
      unit: 'hours', displayOrder: 2,
    },
    {
      ...tariffGroup, scope: AttributeScope.MODULE, key: 'TARIFF_REACTIVATION_CONFLICT_CHECK',
      label: 'Conflict Check on Reactivation', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether reactivating an inactive tariff re-checks for scope/date conflicts with other tariffs',
      trueLabel: 'Required', falseLabel: 'Skipped', displayOrder: 3,
    },
    {
      ...tariffGroup, scope: AttributeScope.MODULE, key: 'TARIFF_ACTIVE_LOCKED_FIELDS',
      label: 'Fields Requiring a New Version', valueType: AttributeValueType.TEXT,
      value: 'propertyType,rateType,flatRate,tiers,applicability,propertyIds,unitIds,billingServiceFee,vat,effectiveFrom',
      description: 'Comma-separated field names that cannot be edited on an active tariff — changing any of them requires creating a new version instead',
      displayOrder: 4,
    },

    // ── Module Attributes: Meter Management → Bulk Import ──────────────────
    // Governs Master/Sub Meter Excel import + export. Column lists are the
    // single source of truth for generated templates, upload validation, and
    // export headers — add/remove/reorder a column here, not in code. Stored
    // as a plain TEXT attribute (a JSON-stringified array) — same convention
    // already used by TARIFF_ACTIVE_LOCKED_FIELDS for a structured value,
    // no new Attribute value type needed.
    {
      ...meterImportGroup, scope: AttributeScope.MODULE, key: 'MASTER_METER_IMPORT_COLUMNS',
      label: 'Master Meter Import Column Configuration', valueType: AttributeValueType.TEXT,
      description: 'Configure the column headers used in the Master Meter import/export template. Locked columns are mandatory and cannot be disabled.',
      value: JSON.stringify([
        { internalField: 'masterMeterId', displayLabel: 'Master Meter ID', mandatory: true, locked: true, enabled: true },
        { internalField: 'serialNumber', displayLabel: 'Serial Number', mandatory: true, locked: true, enabled: true },
        { internalField: 'dtuId', displayLabel: 'DTU ID', mandatory: true, locked: true, enabled: true },
        { internalField: 'community', displayLabel: 'Community', mandatory: true, locked: true, enabled: true },
        { internalField: 'property', displayLabel: 'Property', mandatory: true, locked: true, enabled: true },
        { internalField: 'mBusAddress', displayLabel: 'M-Bus Address', mandatory: true, locked: true, enabled: true },
        { internalField: 'status', displayLabel: 'Status', mandatory: true, locked: true, enabled: true },
        { internalField: 'meterMake', displayLabel: 'Meter Make', mandatory: false, locked: false, enabled: true },
        { internalField: 'meterModel', displayLabel: 'Meter Model', mandatory: false, locked: false, enabled: true },
        { internalField: 'installationDate', displayLabel: 'Installation Date', mandatory: false, locked: false, enabled: true },
      ]),
      displayOrder: 1,
    },
    {
      ...meterImportGroup, scope: AttributeScope.MODULE, key: 'SUB_METER_IMPORT_COLUMNS',
      label: 'Sub-Meter Import Column Configuration', valueType: AttributeValueType.TEXT,
      description: 'Configure the column headers used in the Sub-Meter import/export template. Locked columns are mandatory and cannot be disabled.',
      value: JSON.stringify([
        { internalField: 'subMeterId', displayLabel: 'Sub-Meter ID', mandatory: true, locked: true, enabled: true },
        { internalField: 'serialNumber', displayLabel: 'Serial Number', mandatory: true, locked: true, enabled: true },
        { internalField: 'masterMeterId', displayLabel: 'Master Meter ID', mandatory: true, locked: true, enabled: true },
        { internalField: 'community', displayLabel: 'Community', mandatory: true, locked: true, enabled: true },
        { internalField: 'property', displayLabel: 'Property', mandatory: true, locked: true, enabled: true },
        { internalField: 'unitNumber', displayLabel: 'Unit Number', mandatory: true, locked: true, enabled: true },
        { internalField: 'mBusAddress', displayLabel: 'M-Bus Address', mandatory: true, locked: true, enabled: true },
        { internalField: 'status', displayLabel: 'Status', mandatory: true, locked: true, enabled: true },
        { internalField: 'floor', displayLabel: 'Floor', mandatory: false, locked: false, enabled: true },
        { internalField: 'meterMake', displayLabel: 'Meter Make', mandatory: false, locked: false, enabled: true },
        { internalField: 'meterModel', displayLabel: 'Meter Model', mandatory: false, locked: false, enabled: true },
        { internalField: 'installationDate', displayLabel: 'Installation Date', mandatory: false, locked: false, enabled: true },
        { internalField: 'customerAccountNumber', displayLabel: 'Customer Account Number', mandatory: false, locked: false, enabled: true },
      ]),
      displayOrder: 2,
    },
  ];
}

// Keys that used to be seeded but have since been retired — pruned from
// already-initialized databases on the next bootstrap so a removed attribute
// doesn't linger just because seedValues() only ever inserts, never deletes.
const RETIRED_ATTRIBUTE_KEYS = ['DEFAULT_CYCLE_STATUS_ACTIVE', 'METER_BULK_IMPORT_APPROVAL_THRESHOLD'];

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

  // Parses a TEXT attribute's value as a JSON array (e.g. an import/export
  // column configuration) — the array is JSON.stringify'd into the same
  // plain `value` column every attribute already uses, no new Attribute
  // value type involved. Returns an empty array if the attribute is missing
  // or fails to parse, so callers can treat "no config" the same as "no
  // columns" rather than throwing.
  async getJsonValueByKey<T = unknown>(key: string): Promise<T[]> {
    const raw = await this.getValueByKey(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  // Centralizes the boolean-attribute convention ('true'/'false' string
  // value) so callers checking "is this field mandatory?" don't each
  // re-derive the comparison — used by any module-attribute-driven
  // conditionally-required field (see UserService.DYNAMIC_FIELD_REQUIREMENTS).
  async isMandatory(key: string): Promise<boolean> {
    return (await this.getValueByKey(key)) === 'true';
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
      'TARIFF_DEFAULT_VAT_RATE',
      'TARIFF_APPROVAL_SLA_HOURS',
      'TARIFF_REACTIVATION_CONFLICT_CHECK',
      'TARIFF_ACTIVE_LOCKED_FIELDS',
      'BILLING_CYCLE_DEFAULT_BILL_GENERATION_DAYS',
      'BILLING_CYCLE_DEFAULT_BILL_ISSUE_DAYS',
      'BILLING_CYCLE_DEFAULT_BILL_DUE_DAYS',
      'MASTER_METER_IMPORT_COLUMNS',
      'SUB_METER_IMPORT_COLUMNS',
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

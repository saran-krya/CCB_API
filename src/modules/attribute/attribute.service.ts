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
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { AttributeQueryDto, attributeValueErrorMessage, isValueValidForType, UpdateAttributeDto } from './dto/attribute.dto';
import { Attribute, AttributeScope, AttributeValueType } from './entities/attribute.entity';
import { LOCKABLE_TARIFF_FIELDS } from '../tariff/tariff.constants';
import { REGISTRATION_TERMS_AND_CONDITIONS_DEFAULT } from '../../bootstrap/seed-data';

const CYCLE_SENSITIVE_KEYS = new Set([
  'VAT_RATE',
  'SUPER_ADMIN_REVOKE_AFTER_CYCLE_CLOSE',
  'SUPER_ADMIN_FORCE_TARIFF_ACTIVATION',
  'FINANCE_OVERRIDE_VALIDATION_AT_BILL_RUN',
]);

const ATTRIBUTE_BOUNDS: Record<string, { min: number; max: number }> = {
  SESSION_TIMEOUT_MINUTES: { min: 30, max: 1440 }, // 30 minutes to 24 hours
};

function assertValidLockableTariffFields(value: string): void {
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  if (!fields.length) {
    throw new BadRequestException('At least one field must be selected');
  }

  const invalid = fields.filter((field) => !LOCKABLE_TARIFF_FIELDS.has(field));
  if (invalid.length) {
    throw new BadRequestException(`Invalid field name(s): ${invalid.join(', ')}`);
  }
}

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
      | 'customerValue'
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
    groupDescription: 'Approval thresholds and general settings for Master Meter and Sub Meter bulk import/export',
  };

  const registrationDepositGroup = {
    module: 'customer',
    groupKey: 'registration_deposit',
    groupLabel: 'Registration Deposit',
    groupDescription: 'Whether the security deposit and activation fee are demanded when a registration request is raised',
  };

  const registrationDocumentCaptureGroup = {
    module: 'customer',
    groupKey: 'registration_document_capture',
    groupLabel: 'Registration Document Capture',
    groupDescription: 'Whether the registration wizard extracts document fields via OCR, or the applicant enters them manually',
  };

  const registrationWizardAssistanceGroup = {
    module: 'customer',
    groupKey: 'registration_wizard_assistance',
    groupLabel: 'Wizard Assistance',
    groupDescription: 'Visibility of the registration wizard\'s optional help surfaces — independent of each other and of document capture',
  };

  const registrationFieldRequirementsGroup = {
    module: 'customer',
    groupKey: 'registration_field_requirements',
    groupLabel: 'Field Requirements',
    groupDescription: 'Which registration wizard fields must be filled in before the applicant can proceed — enforced on both the wizard and the submit-for-review API call',
  };

  const ticketAssignmentGroup = {
    module: 'customer',
    groupKey: 'ticket_team_assignment',
    groupLabel: 'Team Assignment by Category',
    groupDescription: 'Whether raising a ticket in this category requires an explicit team assignment before it can progress',
  };

  const ticketRoutingGroup = {
    module: 'customer',
    groupKey: 'ticket_single_department_routing',
    groupLabel: 'Single-Department Routing',
    groupDescription: 'Which department a Support Ticket category routes to',
  };

  return [
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
    {
      scope: AttributeScope.SYSTEM, key: 'REGISTRATION_TERMS_AND_CONDITIONS', label: 'Terms & Conditions Text',
      description: 'Shown on the registration wizard\'s Review & Submit step; the applicant must accept it before the request can be submitted for approval',
      valueType: AttributeValueType.TEXT, value: REGISTRATION_TERMS_AND_CONDITIONS_DEFAULT, displayOrder: 8,
    },

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

    {
      ...userManagementGroup, scope: AttributeScope.MODULE, key: 'REPORTING_MANAGER_MANDATORY',
      label: 'Reporting Manager Mandatory', valueType: AttributeValueType.BOOLEAN, value: 'false',
      description: 'Whether a Reporting Manager must be selected when creating a user',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 1,
    },

    {
      ...roleManagementGroup, scope: AttributeScope.MODULE, key: 'PERMISSION_TREE_CASCADE_ENABLED',
      label: 'Permission Tree Cascade', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether checking a module/sub-module in the permission tree auto-selects everything beneath it',
      trueLabel: 'Cascade to Children', falseLabel: 'Explicit Selection Only', displayOrder: 1,
    },

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
      label: 'Fields Locked for Active Tariffs', valueType: AttributeValueType.TEXT,
      value: 'propertyType,rateType,flatRate,tiers,applicability,propertyIds,unitIds,billingServiceFee,vat,effectiveFrom',
      description: 'Defines which fields are locked when editing an active tariff. After invoicing, a new tariff version is required.',
      displayOrder: 4,
    },

    {
      ...meterImportGroup, scope: AttributeScope.MODULE, key: 'MASTER_METER_IMPORT_COLUMNS',
      label: 'Master Meter Import Column Configuration', valueType: AttributeValueType.TEXT,
      description: 'Configure the column headers used in the Master Meter import/export template. Locked columns are mandatory and cannot be disabled.',
      value: JSON.stringify([
        { internalField: 'masterMeterId', displayLabel: 'Master Meter ID', mandatory: true, locked: true, enabled: true },
        { internalField: 'serialNumber', displayLabel: 'Serial Number', mandatory: true, locked: true, enabled: true },
        { internalField: 'dtuId', displayLabel: 'DTU ID', mandatory: true, locked: true, enabled: true },
        { internalField: 'community', displayLabel: 'Community Code', mandatory: true, locked: true, enabled: true },
        { internalField: 'property', displayLabel: 'Property Code', mandatory: true, locked: true, enabled: true },
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
        { internalField: 'community', displayLabel: 'Community Code', mandatory: true, locked: true, enabled: true },
        { internalField: 'property', displayLabel: 'Property Code', mandatory: true, locked: true, enabled: true },
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

    {
      ...registrationDepositGroup, scope: AttributeScope.MODULE, key: 'SECURITY_DEPOSIT_MANDATORY_OWNER',
      label: 'Security Deposit Mandatory — Owner', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether the Security Deposit is included in the demand raised for an Owner registration',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 1,
    },
    {
      ...registrationDepositGroup, scope: AttributeScope.MODULE, key: 'SECURITY_DEPOSIT_MANDATORY_TENANT',
      label: 'Security Deposit Mandatory — Tenant', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether the Security Deposit is included in the demand raised for a Tenant registration',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 2,
    },
    {
      ...registrationDepositGroup, scope: AttributeScope.MODULE, key: 'ACTIVATION_FEE_MANDATORY',
      label: 'Activation Fee Mandatory', valueType: AttributeValueType.BOOLEAN, value: 'false',
      description: 'Whether the Activation Fee is included in the raised registration demand by default',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 3,
    },

    {
      ...registrationDocumentCaptureGroup, scope: AttributeScope.MODULE, key: 'OCR_DATA_ENTRY_ENABLED',
      label: 'OCR-Based Data Entry', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Yes = documents are extracted via OCR on upload. No = the applicant enters document fields manually and no extraction runs',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 1,
    },

    {
      ...registrationWizardAssistanceGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_FAQ_ENABLED',
      label: 'Show Help & FAQ Panel', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'No = the wizard\'s Help & FAQ rail renders on no step at all — not expanded, not as a collapsed strip',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 1,
      // Explicit Customer-facing override, seeded to match today's real (pre-audience-split)
      // behavior exactly — this is the ONE attribute with a genuine Staff/User vs Customer business
      // need (see the registration-flow audit); every other attribute's seed row omits
      // customerValue entirely, leaving it NULL (falls back to the global `value`, unchanged).
      customerValue: 'true',
    },
    {
      ...registrationWizardAssistanceGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_CHAT_ENABLED',
      label: 'Show Chat Assistant', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'No = the registration chat assistant renders nothing — no launcher, no panel',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 2,
    },

    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_NAME_MANDATORY',
      label: 'Applicant Name Mandatory', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether First/Last Name (Individual) or Contact Person Name (Corporate) must be filled in on the Account step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 1,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_EMAIL_MANDATORY',
      label: 'Email Mandatory', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Email must be filled in before the registration request can be submitted for approval',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 2,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_MOBILE_MANDATORY',
      label: 'Mobile Mandatory', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Mobile must be filled in before the registration request can be submitted for approval',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 3,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_EMERGENCY_CONTACT_MANDATORY',
      label: 'Emergency Contact Mandatory (once started)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Emergency Contact Name/Phone become required once the applicant has filled in any one emergency contact field',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 4,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_PRINCIPAL_MANDATORY',
      label: 'Principal Details Mandatory (Authorized Representative)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Principal Name/Email/Phone are required when the applicant is an Authorized Representative marked as the primary recipient',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 5,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_TRADE_LICENSE_NUMBER_MANDATORY',
      label: 'Trade License Number Mandatory (Corporate)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Trade License Number must be filled in on the Corporate Details step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 6,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_MANAGER_NAME_MANDATORY',
      label: 'Manager Name Mandatory (Corporate)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Manager Name must be filled in on the Corporate Details step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 7,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_TAXABLE_ENTITY_NAME_MANDATORY',
      label: 'Taxable Entity Name Mandatory (Corporate)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Taxable Entity Name must be filled in on the Corporate Details step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 8,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_TRN_MANDATORY',
      label: 'TRN Mandatory (Corporate)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether TRN must be filled in on the Corporate Details step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 9,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_EFFECTIVE_REGISTRATION_DATE_MANDATORY',
      label: 'Effective Registration Date Mandatory (Corporate)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Effective Registration Date must be filled in on the Corporate Details step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 10,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_ISSUING_AUTHORITY_MANDATORY',
      label: 'Issuing Authority Mandatory (Corporate)', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether Issuing Authority must be filled in on the Corporate Details step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 11,
    },
    {
      ...registrationFieldRequirementsGroup, scope: AttributeScope.MODULE, key: 'REGISTRATION_PAYMENT_METHOD_MANDATORY',
      label: 'Payment Method Mandatory', valueType: AttributeValueType.BOOLEAN, value: 'true',
      description: 'Whether at least one payment method (with exactly one marked default) must be added on the Payment step',
      trueLabel: 'Mandatory', falseLabel: 'Optional', displayOrder: 12,
    },

    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'BILLING_DISPUTE_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Billing Dispute Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 1,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'METER_READING_ISSUE_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Meter Reading Issue Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'true',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 2,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'TECHNICAL_ISSUE_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Technical Issue Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 3,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'CONTRACT_QUERY_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Contract Query Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 4,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'MOVE_OUT_REQUEST_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Move-Out Request Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 5,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'DISCONNECTION_REQUEST_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Disconnection Request Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 6,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'RECONNECTION_REQUEST_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Reconnection Request Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 7,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'GENERAL_INQUIRY_REQUIRES_TEAM_ASSIGNMENT',
      label: 'General Inquiry Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 8,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'MOVE_IN_INTIMATION_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Move-In Intimation Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 9,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'OWNERSHIP_TENANCY_CHANGE_REQUEST_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Ownership/Tenancy Change Request Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 10,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'FINAL_BILL_REQUEST_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Final Bill Request Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 11,
    },
    {
      ...ticketAssignmentGroup, scope: AttributeScope.MODULE, key: 'VACANCY_DECLARATION_REQUIRES_TEAM_ASSIGNMENT',
      label: 'Vacancy Declaration Requires Team Assignment', valueType: AttributeValueType.BOOLEAN, value: 'false',
      trueLabel: 'Yes', falseLabel: 'No', displayOrder: 12,
    },

    {
      ...ticketRoutingGroup, scope: AttributeScope.MODULE, key: 'BILLING_DISPUTE_DEPARTMENT',
      label: 'Billing Dispute Department', valueType: AttributeValueType.TEXT, value: 'Billing',
      displayOrder: 1,
    },
    {
      ...ticketRoutingGroup, scope: AttributeScope.MODULE, key: 'METER_READING_ISSUE_DEPARTMENT',
      label: 'Meter Reading Issue Department', valueType: AttributeValueType.TEXT, value: 'Field Operations',
      displayOrder: 2,
    },
    {
      ...ticketRoutingGroup, scope: AttributeScope.MODULE, key: 'TECHNICAL_ISSUE_DEPARTMENT',
      label: 'Technical Issue Department', valueType: AttributeValueType.TEXT, value: 'Field Operations',
      displayOrder: 3,
    },
    {
      ...ticketRoutingGroup, scope: AttributeScope.MODULE, key: 'CONTRACT_QUERY_DEPARTMENT',
      label: 'Contract Query Department', valueType: AttributeValueType.TEXT, value: 'Contract Management',
      displayOrder: 4,
    },
    {
      ...ticketRoutingGroup, scope: AttributeScope.MODULE, key: 'GENERAL_INQUIRY_DEPARTMENT',
      label: 'General Inquiry Department', valueType: AttributeValueType.TEXT, value: 'CS',
      displayOrder: 5,
    },
  ];
}

const RETIRED_ATTRIBUTE_KEYS = [
  'DEFAULT_CYCLE_STATUS_ACTIVE',
  'METER_BULK_IMPORT_APPROVAL_THRESHOLD',
  // Superseded by independent SECURITY_DEPOSIT_MANDATORY_OWNER/_TENANT — the old single global flag
  // couldn't express "required for Tenants but not Owners" (or vice versa); OWNER_LEASEOUT_DEPOSIT_
  // ENABLED was only ever a narrower owner-specific override of that same global flag, now folded
  // into the Owner key directly.
  'SECURITY_DEPOSIT_MANDATORY',
  'OWNER_LEASEOUT_DEPOSIT_ENABLED',
];

@Injectable()
export class AttributeService {
  constructor(
    @InjectRepository(Attribute)
    private readonly attributes: Repository<Attribute>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly rolePermissions: RolePermissionsService,
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

  /** The Customer-facing counterpart to getValueByKey — falls back to the same global `value` when
   *  no Customer-specific override is configured (customerValue is NULL), so an attribute with no
   *  override behaves identically for Customer and Staff/User. Only call this from a customer-safe
   *  composition path (e.g. CustomerPortalService.getMyRegistrationConfig) — Staff/User reads must
   *  keep using getValueByKey, never this. */
  async getCustomerValueByKey(key: string): Promise<string | null> {
    const attribute = await this.attributes.findOne({ where: { key } });
    if (!attribute) return null;
    return attribute.customerValue ?? attribute.value;
  }

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

  async isMandatory(key: string): Promise<boolean> {
    return (await this.getValueByKey(key)) === 'true';
  }

  async update(
    id: number,
    dto: UpdateAttributeDto,
    actorId?: number,
    actorRoleName?: string,
    actorRoleId?: number,
  ): Promise<Attribute> {
    const attribute = await this.attributes.findOne({ where: { id } });
    if (!attribute) throw new NotFoundException('Attribute not found');

    if (attribute.scope === AttributeScope.SYSTEM && actorRoleName !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('Only Super Admin can edit General Attributes');
    }

    // Authorization moved here from the controller's @Permission decorator because it now varies
    // per attribute key: every attribute requires EDIT_ATTRIBUTE, EXCEPT OCR_DATA_ENTRY_ENABLED,
    // which anyone with Registration Request create/edit access may also flip — it's surfaced as a
    // toggle inside the registration wizard itself (System Admin -> Attributes remains the other
    // place to change it). Permission-code checks throughout, never a role-name check, so this
    // generalizes to whatever role is actually granted these action codes.
    const extraAllowedActionCodesByKey: Record<string, string[]> = {
      OCR_DATA_ENTRY_ENABLED: ['CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST'],
    };
    const hasEditAttribute = !!actorRoleId && (await this.rolePermissions.roleHasAction(actorRoleId, 'EDIT_ATTRIBUTE'));
    if (!hasEditAttribute) {
      const extraActionCodes = extraAllowedActionCodesByKey[attribute.key] ?? [];
      const hasExtra =
        !!actorRoleId &&
        (await Promise.all(extraActionCodes.map((code) => this.rolePermissions.roleHasAction(actorRoleId, code)))).some(
          Boolean,
        );
      if (!hasExtra) {
        throw new ForbiddenException(`You do not have permission to edit "${attribute.label}"`);
      }
    }

    const { changeReason, ...fields } = dto;

    if (!attribute.editable && fields.value !== undefined && fields.value !== attribute.value) {
      throw new ConflictException(`"${attribute.label}" is not editable`);
    }

    if (fields.value !== undefined && !isValueValidForType(fields.value, attribute.valueType)) {
      throw new BadRequestException(attributeValueErrorMessage(attribute.valueType));
    }

    // customerValue: same type validation as value, but `null` is always valid — it means "clear
    // the override, fall back to the global value" (see Attribute.customerValue's own doc comment).
    if (
      fields.customerValue !== undefined &&
      fields.customerValue !== null &&
      !isValueValidForType(fields.customerValue, attribute.valueType)
    ) {
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

    if (attribute.key === 'TARIFF_ACTIVE_LOCKED_FIELDS' && fields.value !== undefined) {
      assertValidLockableTariffFields(fields.value);
    }

    if (CYCLE_SENSITIVE_KEYS.has(attribute.key) && fields.value !== undefined && !changeReason?.trim()) {
      throw new ConflictException('A reason for change is required for this parameter');
    }

    const oldValue = { value: attribute.value, customerValue: attribute.customerValue, editable: attribute.editable };
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
        customerValue: null,
        ...row,
      });
      await manager.save(Attribute, entity);
    }
  }

  async ensureCriticalDefaults(): Promise<void> {
    await this.attributes.delete({ key: In(RETIRED_ATTRIBUTE_KEYS) });

    const sessionTimeoutMinutes = this.config.get<number>('SESSION_TIMEOUT_MINUTES', 30);
    const seedRows = buildAttributeSeed(sessionTimeoutMinutes);

    // Every seed-defined key is critical to backfill onto an existing database — derived directly
    // from seedRows (never a hand-maintained duplicate list) so a newly added attribute can never
    // again silently ship without ever reaching an existing installation. This is exactly the bug
    // a hand-typed criticalKeys array had: CUSTOMER_PORTAL_ACCESS/SELF_SERVICE_PAYMENT/
    // DISPUTE_AUTO_ACK_HOURS/UAE_PASS_AUTHENTICATION and 6 SYSTEM-scope keys were defined in
    // buildAttributeSeed() from day one but never listed here, so they never backfilled onto any
    // database that existed before this file did.
    const criticalKeys = seedRows.map((r) => r.key);

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

    await this.refreshRelabeledColumnConfigs(seedRows);
    await this.backfillCustomerValueDefaults(seedRows);
  }

  /** One-time backfill for an existing installation's already-present row: `ensureCriticalDefaults`
   *  above only creates MISSING rows (`if (exists) continue`), so REGISTRATION_FAQ_ENABLED's real,
   *  already-inserted row would otherwise never receive its seeded customerValue — leaving it NULL
   *  (global fallback) even though the seed intends an explicit 'true' override matching today's
   *  actual behavior (see buildAttributeSeed's own REGISTRATION_FAQ_ENABLED row). Only ever sets a
   *  customerValue that's currently NULL — never overwrites an Admin's own configured override — so
   *  this is safe to run on every boot without undoing any change an Admin has already made. */
  private async backfillCustomerValueDefaults(seedRows: AttributeSeedRow[]): Promise<void> {
    for (const row of seedRows) {
      if (row.customerValue === undefined || row.customerValue === null) continue;
      await this.attributes
        .createQueryBuilder()
        .update()
        .set({ customerValue: row.customerValue })
        .where('`key` = :key AND customer_value IS NULL', { key: row.key })
        .execute();
    }
  }

  private async refreshRelabeledColumnConfigs(seedRows: AttributeSeedRow[]): Promise<void> {
    const columnConfigKeys = ['MASTER_METER_IMPORT_COLUMNS', 'SUB_METER_IMPORT_COLUMNS'];

    for (const key of columnConfigKeys) {
      const seedRow = seedRows.find((r) => r.key === key);
      const existing = await this.attributes.findOne({ where: { key } });
      if (!seedRow || !existing) continue;

      let seedColumns: { internalField: string; displayLabel: string }[];
      let currentColumns: { internalField: string; displayLabel: string; [k: string]: unknown }[];
      try {
        seedColumns = JSON.parse(seedRow.value);
        currentColumns = JSON.parse(existing.value);
      } catch {
        continue;
      }

      const seedLabelByField = new Map(seedColumns.map((c) => [c.internalField, c.displayLabel]));
      let changed = false;
      const relabeled = currentColumns.map((col) => {
        const newLabel = seedLabelByField.get(col.internalField);
        if (newLabel && newLabel !== col.displayLabel) {
          changed = true;
          return { ...col, displayLabel: newLabel };
        }
        return col;
      });

      if (changed) {
        await this.attributes.update({ key }, { value: JSON.stringify(relabeled) });
      }
    }

    const meterGroupSeedRow = seedRows.find((r) => r.key === columnConfigKeys[0]);
    if (meterGroupSeedRow?.groupKey && meterGroupSeedRow.groupDescription) {
      await this.attributes.update(
        { groupKey: meterGroupSeedRow.groupKey },
        { groupDescription: meterGroupSeedRow.groupDescription },
      );
    }
  }
}

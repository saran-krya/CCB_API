import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { AttributeService } from '../attribute/attribute.service';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { CustomerService } from '../customer/customer.service';
import {
  CreateCustomerDto,
  CreateCompanyDto,
} from '../customer/dto/create-customer.dto';
import {
  CustomerActivationRequiredEvent,
  CUSTOMER_ACTIVATION_REQUIRED_EVENT,
} from '../customer/events/customer-activation-required.event';
import { CustomerAccountStatus, CustomerAccountType, CustomerContactType, CustomerLegalStructure, ResidentType } from '../customer/entities/customer.entity';
import {
  ApplicableDocumentRuleQueryDto,
} from '../registration-document-rule/dto/registration-document-rule.dto';
import {
  RegistrationDocumentAccountType,
  RegistrationDocumentContactType,
  RegistrationDocumentResident,
} from '../registration-document-rule/entities/registration-document-rule.entity';
import { RegistrationDocumentRuleService } from '../registration-document-rule/registration-document-rule.service';
import { TariffService } from '../tariff/tariff.service';
import { BillingCycleService } from '../billing-cycle/billing-cycle.service';
import { LovService } from '../lov/lov.service';
import { UnitService } from '../unit/unit.service';
import {
  ActionByDto,
  CreateRegistrationRequestDraftDto,
  MandatoryCommentActionDto,
  PaymentMethodDto,
  PropertyBillingDto,
  RecordDepositPaymentDto,
  RegistrationRequestQueryDto,
  RequestDepositDto,
  SelectedUnitDto,
  SetExtractedFieldsDto,
  SetExtractedFieldValueDto,
  ToggleExtractedFieldVerifiedDto,
  UpdateRegistrationRequestDraftDto,
  UploadRegistrationDocumentDto,
} from './dto/registration-request.dto';
import { RegistrationDemand, RegistrationDemandComponent, RegistrationDemandComponentType, RegistrationDemandStatus } from './entities/registration-demand.entity';
import { RegistrationDocument, RegistrationDocumentStatus } from './entities/registration-document.entity';
import {
  ActivationInviteStatus,
  RegistrationAccountType,
  RegistrationChannel,
  RegistrationDepositStatus,
  RegistrationRequest,
  RegistrationRequestStatus,
  RegistrationResidentType,
} from './entities/registration-request.entity';
import { RegistrationRequestUnit } from './entities/registration-request-unit.entity';
import { RegistrationRequestPropertyBilling } from './entities/registration-request-property-billing.entity';
import { RegistrationPaymentMethod } from './entities/registration-payment-method.entity';
import { RegistrationDeposit, RegistrationDepositPaymentStatus } from './entities/registration-deposit.entity';
import { RegistrationCustomerDetail } from './entities/registration-customer-detail.entity';
import { RegistrationCompanyDetail } from './entities/registration-company-detail.entity';
import { RegistrationVersionSnapshot } from './entities/registration-version-snapshot.entity';
import { RegistrationWorkflowAction, RegistrationWorkflowHistoryEntry } from './entities/registration-workflow-history.entity';

// The one workflow status a submitted-but-not-yet-decided request sits in — gates returnToResident
// (send it back to the resident for correction) and is the sole entry in APPROVABLE_FROM_STATUSES
// (the approve/reject decision). Used to also include RETURNED_TO_CS/PENDING_BUSINESS_APPROVAL, the
// "Loop 2"/Business-Approval-stage statuses a request could sit in on its way back from a now-removed
// separate Business Approval decision — that whole intermediate stage is gone (submit lands directly
// in PENDING_CS_REVIEW, where the ONE approve/reject decision already happens), so there is nothing
// left to loop back from and nothing else this list ever needs to include.
const CS_REVIEW_STATUSES = [RegistrationRequestStatus.PENDING_CS_REVIEW];

// The Registration Approval screen's own queue — every status a Customer Service Supervisor still
// has work to do on, whether that's an approve/reject decision or a post-approval deposit
// verification. Kept as its own named list (even though its workflow-status half is currently
// identical to CS_REVIEW_STATUSES) since conceptually it answers a different question — "what does
// this ONE screen show" vs. "is this request still awaiting a submission-side action" — and the two
// could diverge again in the future without either gate silently changing the other's meaning.
//
// Two independent conditions OR'd together — never merged into one list of `status` values, since
// they're two different fields now: (a) still awaiting an approve/reject decision (workflow status
// gate only), or (b) already Approved but the deposit sub-process isn't done yet (depositStatus
// gate — REQUESTED/PAID_PENDING_VERIFICATION are both still live Supervisor work: awaiting the
// customer's payment, or awaiting the Supervisor's own verification of it). Without (b), an Approved
// request with a live deposit in flight would fall through both this queue AND the Approved tab's
// exact-status match and become invisible on the list entirely — reachable only by a direct URL.
const REGISTRATION_APPROVAL_QUEUE_STATUSES = [RegistrationRequestStatus.PENDING_CS_REVIEW];
const REGISTRATION_APPROVAL_QUEUE_DEPOSIT_STATUSES = [
  RegistrationDepositStatus.REQUESTED,
  RegistrationDepositStatus.PAID_PENDING_VERIFICATION,
];

// Every CreateRegistrationRequestDraftDto/UpdateRegistrationRequestDraftDto field that now lives
// on RegistrationCustomerDetail instead of RegistrationRequest — kept as one list so createDraft/
// updateDraft pluck it out of the incoming DTO the same way every time (see extractCustomerDetailFields).
// Person/contact fields ONLY — Company/Trade-License/TRN fields moved to COMPANY_DETAIL_FIELD_KEYS
// below (RegistrationCompanyDetail), split out of what used to be one combined list.
const CUSTOMER_DETAIL_FIELD_KEYS = [
  'salutation', 'firstName', 'middleName', 'lastName', 'occupation', 'alternatePhone',
  'gender', 'dateOfBirth', 'nationality', 'maritalStatus',
  'principalName', 'principalEmail', 'principalPhone', 'principalIsPrimaryRecipient',
  'contactPersonName', 'contactType', 'email', 'mobile',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship',
  'preferredLanguage', 'preferredCommunicationChannel', 'photoUrl',
  'propertyDocumentType', 'propertyDocumentReference',
] as const satisfies readonly (keyof RegistrationCustomerDetail)[];

type CustomerDetailFields = Partial<Pick<RegistrationCustomerDetail, (typeof CUSTOMER_DETAIL_FIELD_KEYS)[number]>>;

function extractCustomerDetailFields<T extends Partial<Record<(typeof CUSTOMER_DETAIL_FIELD_KEYS)[number], unknown>>>(
  dto: T,
): { details: CustomerDetailFields; rest: Omit<T, (typeof CUSTOMER_DETAIL_FIELD_KEYS)[number]> } {
  const details: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { ...dto };
  for (const key of CUSTOMER_DETAIL_FIELD_KEYS) {
    if (key in rest) {
      details[key] = rest[key];
      delete rest[key];
    }
  }
  return { details: details as CustomerDetailFields, rest: rest as Omit<T, (typeof CUSTOMER_DETAIL_FIELD_KEYS)[number]> };
}

// Company/Trade-License/TRN fields — routed onto RegistrationCompanyDetail instead of
// RegistrationCustomerDetail. companyRegistrationNumber/trnExpiryDate are new (previously had no
// registration-side source field at all).
const COMPANY_DETAIL_FIELD_KEYS = [
  'legalStructure', 'companyRegistrationDate', 'companyRegistrationNumber',
  'tradeLicenseNumber', 'licenseExpiryDate', 'managerName', 'tradeLicenseVerified',
  'trn', 'trnExpiryDate', 'taxableEntityName', 'effectiveRegistrationDate', 'issuingAuthority',
  'trnVerified',
] as const satisfies readonly (keyof RegistrationCompanyDetail)[];

type CompanyDetailFields = Partial<Pick<RegistrationCompanyDetail, (typeof COMPANY_DETAIL_FIELD_KEYS)[number]>>;

function extractCompanyDetailFields<T extends Partial<Record<(typeof COMPANY_DETAIL_FIELD_KEYS)[number], unknown>>>(
  dto: T,
): { details: CompanyDetailFields; rest: Omit<T, (typeof COMPANY_DETAIL_FIELD_KEYS)[number]> } {
  const details: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { ...dto };
  for (const key of COMPANY_DETAIL_FIELD_KEYS) {
    if (key in rest) {
      details[key] = rest[key];
      delete rest[key];
    }
  }
  return { details: details as CompanyDetailFields, rest: rest as Omit<T, (typeof COMPANY_DETAIL_FIELD_KEYS)[number]> };
}

interface DynamicFieldRequirement {
  field: keyof RegistrationCustomerDetail;
  attributeKey: string;
  label: string;
  appliesTo?: (request: RegistrationRequest) => boolean;
}

interface CompanyDynamicFieldRequirement {
  field: keyof RegistrationCompanyDetail;
  attributeKey: string;
  label: string;
  appliesTo?: (request: RegistrationRequest) => boolean;
}

// Mirrors UserService's DYNAMIC_FIELD_REQUIREMENTS/assertDynamicRequiredFields pattern — each
// wizard field's mandatory-ness is a real, admin-configurable Attribute (module 'customer', group
// 'registration_field_requirements') rather than a value baked into this service. `appliesTo` keeps
// conditional fields (Corporate-only, Authorized-Representative-only) from being demanded outside
// the context they're actually shown in. Person/contact fields only — Company fields are the
// separate COMPANY_DYNAMIC_FIELD_REQUIREMENTS list below, since they now read from
// request.companyDetail instead of request.customerDetails.
const DYNAMIC_FIELD_REQUIREMENTS: DynamicFieldRequirement[] = [
  { field: 'email', attributeKey: 'REGISTRATION_EMAIL_MANDATORY', label: 'Email' },
  { field: 'mobile', attributeKey: 'REGISTRATION_MOBILE_MANDATORY', label: 'Mobile' },
];

// Company/Trade-License/TRN mandatory-field checks — same admin-configurable Attribute pattern as
// DYNAMIC_FIELD_REQUIREMENTS above, checked against request.companyDetail instead.
const COMPANY_DYNAMIC_FIELD_REQUIREMENTS: CompanyDynamicFieldRequirement[] = [
  {
    field: 'tradeLicenseNumber', attributeKey: 'REGISTRATION_TRADE_LICENSE_NUMBER_MANDATORY', label: 'Trade License Number',
    appliesTo: (r) => r.accountType === RegistrationAccountType.CORPORATE,
  },
  {
    field: 'managerName', attributeKey: 'REGISTRATION_MANAGER_NAME_MANDATORY', label: 'Manager Name',
    appliesTo: (r) => r.accountType === RegistrationAccountType.CORPORATE,
  },
  {
    field: 'taxableEntityName', attributeKey: 'REGISTRATION_TAXABLE_ENTITY_NAME_MANDATORY', label: 'Taxable Entity Name',
    appliesTo: (r) => r.accountType === RegistrationAccountType.CORPORATE,
  },
  {
    field: 'trn', attributeKey: 'REGISTRATION_TRN_MANDATORY', label: 'TRN',
    appliesTo: (r) => r.accountType === RegistrationAccountType.CORPORATE,
  },
  {
    field: 'effectiveRegistrationDate', attributeKey: 'REGISTRATION_EFFECTIVE_REGISTRATION_DATE_MANDATORY', label: 'Effective Registration Date',
    appliesTo: (r) => r.accountType === RegistrationAccountType.CORPORATE,
  },
  {
    field: 'issuingAuthority', attributeKey: 'REGISTRATION_ISSUING_AUTHORITY_MANDATORY', label: 'Issuing Authority',
    appliesTo: (r) => r.accountType === RegistrationAccountType.CORPORATE,
  },
];

function actorLabel(actorId?: number): string {
  return actorId ? `User #${actorId}` : 'System';
}

/** Flattens the DB-normalized child relations (customerDetails, selectedUnitEntries,
 *  propertyBillingEntries, paymentMethodEntries, depositEntry) back onto a single flat response
 *  object — the shape the frontend has always consumed and the shape the create/update DTOs
 *  already accept as input (see CUSTOMER_DETAIL_FIELD_KEYS/extractCustomerDetailFields above).
 *  This is the one place that undoes the split so callers (findOne/findAll/createDraft/
 *  updateDraft) never need to know the request is normalized across 5 tables internally — the
 *  external API contract stays exactly what it was before that refactor. `request` must have
 *  loaded customerDetails/selectedUnitEntries/propertyBillingEntries/paymentMethodEntries/
 *  depositEntry (whichever of those a given caller's relations option includes; a relation left
 *  unloaded is simply omitted from its flattened field, not defaulted to a wrong value). */
function toFlatResponse(request: RegistrationRequest) {
  const details = request.customerDetails;
  const company = request.companyDetail;
  const { customerDetails: _customerDetails, companyDetail: _companyDetail, selectedUnitEntries, propertyBillingEntries, paymentMethodEntries, depositEntry, ...rest } = request;

  return {
    ...rest,
    salutation: details?.salutation ?? null,
    firstName: details?.firstName ?? null,
    middleName: details?.middleName ?? null,
    lastName: details?.lastName ?? null,
    occupation: details?.occupation ?? null,
    alternatePhone: details?.alternatePhone ?? null,
    principalName: details?.principalName ?? null,
    principalEmail: details?.principalEmail ?? null,
    principalPhone: details?.principalPhone ?? null,
    principalIsPrimaryRecipient: details?.principalIsPrimaryRecipient ?? null,
    propertyDocumentType: details?.propertyDocumentType ?? null,
    propertyDocumentReference: details?.propertyDocumentReference ?? null,
    contactPersonName: details?.contactPersonName ?? null,
    contactType: details?.contactType ?? null,
    gender: details?.gender ?? null,
    dateOfBirth: details?.dateOfBirth ?? null,
    nationality: details?.nationality ?? null,
    maritalStatus: details?.maritalStatus ?? null,
    legalStructure: company?.legalStructure ?? null,
    companyRegistrationDate: company?.companyRegistrationDate ?? null,
    companyRegistrationNumber: company?.companyRegistrationNumber ?? null,
    tradeLicenseNumber: company?.tradeLicenseNumber ?? null,
    trn: company?.trn ?? null,
    trnExpiryDate: company?.trnExpiryDate ?? null,
    licenseExpiryDate: company?.licenseExpiryDate ?? null,
    managerName: company?.managerName ?? null,
    taxableEntityName: company?.taxableEntityName ?? null,
    effectiveRegistrationDate: company?.effectiveRegistrationDate ?? null,
    issuingAuthority: company?.issuingAuthority ?? null,
    tradeLicenseVerified: company?.tradeLicenseVerified ?? null,
    trnVerified: company?.trnVerified ?? null,
    email: details?.email ?? '',
    mobile: details?.mobile ?? '',
    emergencyContactName: details?.emergencyContactName ?? null,
    emergencyContactPhone: details?.emergencyContactPhone ?? null,
    emergencyContactRelationship: details?.emergencyContactRelationship ?? null,
    preferredLanguage: details?.preferredLanguage ?? 'English',
    preferredCommunicationChannel: details?.preferredCommunicationChannel ?? 'Email',
    photoUrl: details?.photoUrl ?? null,

    selectedUnits: selectedUnitEntries
      ? selectedUnitEntries.map((u) => ({ unitId: u.unitId, propertyId: u.propertyId, communityId: u.communityId }))
      : null,
    propertyBilling: propertyBillingEntries
      ? propertyBillingEntries.map((b) => ({ propertyId: b.propertyId, billingType: b.billingType }))
      : null,
    paymentMethods: paymentMethodEntries
      ? paymentMethodEntries.map((m) => ({
          id: String(m.id),
          type: m.type,
          maskedIdentifier: m.maskedIdentifier,
          brandOrBank: m.brandOrBank ?? null,
          expiry: m.expiry ?? null,
          accountHolderName: m.accountHolderName ?? null,
          bankName: m.bankName ?? null,
          isDefault: m.isDefault,
        }))
      : null,

    securityDepositAmount: depositEntry ? Number(depositEntry.amount) : 0,
    depositPaymentStatus: depositEntry?.status ?? RegistrationDepositPaymentStatus.PENDING,
    depositPaymentMethod: depositEntry?.paymentMethod ?? null,
    depositPaymentReference: depositEntry?.paymentReference ?? null,
    depositPaidDate: depositEntry?.paidAt ?? null,
  };
}

@Injectable()
export class RegistrationRequestService {
  private readonly logger = new Logger(RegistrationRequestService.name);

  constructor(
    @InjectRepository(RegistrationRequest)
    private readonly requests: Repository<RegistrationRequest>,
    @InjectRepository(RegistrationDocument)
    private readonly documents: Repository<RegistrationDocument>,
    private readonly tariffService: TariffService,
    private readonly billingCycleService: BillingCycleService,
    private readonly attributeService: AttributeService,
    private readonly documentRules: RegistrationDocumentRuleService,
    private readonly customerService: CustomerService,
    private readonly lovService: LovService,
    private readonly unitService: UnitService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  // ── History / version helpers ──────────────────────────────────────────────────────────────────

  private async appendHistory(
    manager: DataSource['manager'],
    request: RegistrationRequest,
    actionType: RegistrationWorkflowAction,
    actorId: number | undefined,
    comments: string | null,
  ) {
    const entry = manager.create(RegistrationWorkflowHistoryEntry, {
      request,
      actionType,
      actionBy: actorLabel(actorId),
      actionAt: new Date(),
      comments: comments ?? null,
    });
    await manager.save(RegistrationWorkflowHistoryEntry, entry);
  }

  private async appendVersionSnapshot(
    manager: DataSource['manager'],
    request: RegistrationRequest,
    event: string,
    actorId: number | undefined,
  ) {
    const existing = await manager.count(RegistrationVersionSnapshot, { where: { request: { id: request.id } } });
    const versionNumber = existing === 0 ? '0.1' : `0.${existing + 1}`;
    const snapshot = manager.create(RegistrationVersionSnapshot, {
      request,
      versionNumber,
      createdBy: actorLabel(actorId),
      event,
      changedFields: [],
    });
    await manager.save(RegistrationVersionSnapshot, snapshot);
  }

  /** Upserts the request's single customer-details row (person/contact fields only — Company fields
   *  live on RegistrationCompanyDetail, see upsertCompanyDetail below) — a OneToOne, so the first
   *  save (createDraft) creates it and every later save (updateDraft) updates the same row. Only
   *  fields actually present in the payload are applied, same Object.assign-style partial-merge
   *  createDraft/updateDraft already use for the request's own columns — a draft is deliberately
   *  allowed to be filled in over multiple saves. */
  private async upsertCustomerDetails(
    manager: DataSource['manager'],
    request: RegistrationRequest,
    fields: CustomerDetailFields,
  ): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    const existing = request.customerDetails ?? (await manager.findOne(RegistrationCustomerDetail, { where: { request: { id: request.id } } }));
    const details = existing ?? manager.create(RegistrationCustomerDetail, { request });
    Object.assign(details, fields);
    request.customerDetails = await manager.save(RegistrationCustomerDetail, details);
  }

  /** Upserts the request's single company-details row (Company/Trade-License/TRN fields) — same
   *  OneToOne upsert pattern as upsertCustomerDetails above. A row is created lazily, only once a
   *  Company field is actually present in the payload (an Individual request never gets one at
   *  all, since it never sends any of these fields) — matching how upsertCustomerDetails/
   *  upsertDeposit already lazy-create their own child row. */
  private async upsertCompanyDetail(
    manager: DataSource['manager'],
    request: RegistrationRequest,
    fields: CompanyDetailFields,
  ): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    const existing = request.companyDetail ?? (await manager.findOne(RegistrationCompanyDetail, { where: { request: { id: request.id } } }));
    const details = existing ?? manager.create(RegistrationCompanyDetail, { request });
    Object.assign(details, fields);
    request.companyDetail = await manager.save(RegistrationCompanyDetail, details);
  }

  /**
   * Replaces a request's selected units / property billing intent / payment methods with exactly
   * what the draft payload sent — the frontend always PATCHes the whole array (never a partial
   * add/remove diff, per useRegistrationCreation.ts), so a full delete-then-recreate per collection
   * is both correct and simpler than reconciling row-by-row. Each collection is independently
   * optional: `undefined` means "this field wasn't part of this save" and is left untouched;
   * an explicit `[]` clears it. Enforces "exactly one isDefault" on payment methods here, since
   * PaymentMethodDto only validates each entry independently (see its own doc comment).
   */
  private async syncChildCollections(
    manager: DataSource['manager'],
    request: RegistrationRequest,
    dto: { selectedUnits?: SelectedUnitDto[]; propertyBilling?: PropertyBillingDto[]; paymentMethods?: PaymentMethodDto[] },
  ): Promise<void> {
    if (dto.selectedUnits !== undefined) {
      await manager.delete(RegistrationRequestUnit, { request: { id: request.id } });
      if (dto.selectedUnits.length) {
        await manager.save(
          RegistrationRequestUnit,
          dto.selectedUnits.map((u) => manager.create(RegistrationRequestUnit, { request, ...u })),
        );
      }
    }

    if (dto.propertyBilling !== undefined) {
      await manager.delete(RegistrationRequestPropertyBilling, { request: { id: request.id } });
      if (dto.propertyBilling.length) {
        await manager.save(
          RegistrationRequestPropertyBilling,
          dto.propertyBilling.map((b) => manager.create(RegistrationRequestPropertyBilling, { request, ...b })),
        );
      }
    }

    if (dto.paymentMethods !== undefined) {
      if (dto.paymentMethods.length) {
        await this.assertValidPaymentMethodTypes(dto.paymentMethods.map((m) => m.type));
        const defaultCount = dto.paymentMethods.filter((m) => m.isDefault).length;
        if (defaultCount > 1) {
          throw new BadRequestException('Only one payment method can be marked as default.');
        }
      }

      await manager.delete(RegistrationPaymentMethod, { request: { id: request.id } });
      if (dto.paymentMethods.length) {
        const hasDefault = dto.paymentMethods.some((m) => m.isDefault);
        // dto.id is the client-generated timestamp-string id the old JSON-blob shape used
        // (see PaymentMethodDto/RegistrationPaymentMethod docs) — the new row gets its own
        // real auto-increment id, so the incoming one is intentionally dropped, never persisted.
        const methods = dto.paymentMethods.map(({ id: _clientId, ...m }, i) => ({
          ...m,
          // If the caller sent no default at all, the first method wins — same fallback the
          // frontend's own addPaymentMethod already applies to the first method it adds.
          isDefault: hasDefault ? m.isDefault : i === 0,
        }));
        await manager.save(
          RegistrationPaymentMethod,
          methods.map((m) => manager.create(RegistrationPaymentMethod, { request, ...m })),
        );
      }
    }
  }

  /** Validates every submitted payment method's `type` against the real PAYMENT_METHOD_TYPE LOV
   *  codes (`card`, `direct-debit`, etc. — see lov.service.ts's LOV_SEED) — PaymentMethodDto.type
   *  is a plain string with no enum, since the valid set is admin-configurable, not fixed at
   *  compile time; this is the runtime equivalent of TariffService's assertValidUnitType/
   *  assertValidRejectionReason pattern. A direct API call sending an unconfigured type must fail
   *  here, not silently persist a value the LOV admin screen doesn't recognize. */
  private async assertValidPaymentMethodTypes(types: string[]): Promise<void> {
    const validValues = await this.lovService.findByCategory('PAYMENT_METHOD_TYPE');
    const validCodes = new Set(validValues.map((v) => v.code));
    const invalid = [...new Set(types)].filter((t) => !validCodes.has(t));
    if (invalid.length) {
      throw new BadRequestException(
        `Invalid payment method type(s): ${invalid.join(', ')}. Add them under Lookup Field Master (PAYMENT_METHOD_TYPE) first.`,
      );
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────────────────────────────

  async findAll(query: RegistrationRequestQueryDto) {
    const { status, channel, search, sortBy, sortOrder, csQueue, customerId } = query;

    const qb = this.requests
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.customerDetails', 'cd')
      .leftJoinAndSelect('r.companyDetail', 'cod')
      .leftJoinAndSelect('r.selectedUnitEntries', 'units')
      .leftJoin('r.customer', 'customer')
      .orderBy(`r.${sortBy ?? 'createdAt'}`, sortOrder ?? 'DESC');

    // Registration Requests' own default view (no `status`/`csQueue` — i.e. no explicit status
    // scope requested) never shows an already-approved request — once a request is approved it
    // becomes a real Customer record (see approve()), and Customer List is its home from then on;
    // showing it here too would duplicate it across two screens. Excludes on `customer IS NOT
    // NULL` (equivalent to `status = 'Approved'` now that the deposit sub-process lives entirely on
    // its own `depositStatus` column rather than inside `status` — see RegistrationDepositStatus's
    // own doc comment — but kept as the customer-existence check since that's the one true
    // "has approval happened" signal). This does NOT apply when the caller explicitly asked for a
    // status (e.g. Registration Approval's own "Approved" history tab sending status=Approved) or
    // for the csQueue set — those are deliberate, explicit requests for that status, not the ambient
    // "everything" list. The record itself is never deleted (audit requirement) — findOne(id)
    // always returns it directly by id regardless of this exclusion.
    if (!status && !csQueue && !customerId) {
      qb.andWhere('customer.id IS NULL');
    }

    if (status) qb.andWhere('r.status = :status', { status });
    // Registration Approval queue (reviewed by the Customer Service Supervisor role) — every
    // request awaiting an approve/reject decision, never drafts. Mutually exclusive with `status`
    // in practice (the frontend never sends both).
    if (csQueue) {
      qb.andWhere(
        '(r.status IN (:...csStatuses) OR (r.status = :approvedStatus AND r.depositStatus IN (:...csDepositStatuses)))',
        {
          csStatuses: REGISTRATION_APPROVAL_QUEUE_STATUSES,
          approvedStatus: RegistrationRequestStatus.APPROVED,
          csDepositStatuses: REGISTRATION_APPROVAL_QUEUE_DEPOSIT_STATUSES,
        },
      );
    }
    if (channel) qb.andWhere('r.channel = :channel', { channel });
    if (customerId) qb.andWhere('customer.id = :customerId', { customerId });
    if (search) {
      qb.andWhere(
        '(r.businessCode LIKE :s OR cd.firstName LIKE :s OR cd.lastName LIKE :s OR cd.contactPersonName LIKE :s OR cd.email LIKE :s)',
        { s: `%${search}%` },
      );
    }

    const result = await paginate(qb, query);
    return { ...result, items: result.items.map((r) => toFlatResponse(r)) };
  }

  async findOne(id: number) {
    const request = await this.requests.findOne({
      where: { id },
      relations: {
        documents: true,
        workflowHistory: true,
        versions: true,
        demands: true,
        customer: true,
        customerDetails: true,
        companyDetail: true,
        selectedUnitEntries: true,
        propertyBillingEntries: true,
        paymentMethodEntries: true,
        depositEntry: true,
      },
    });
    if (!request) throw new NotFoundException('Registration request not found');
    request.workflowHistory?.sort((a, b) => a.actionAt.getTime() - b.actionAt.getTime());
    request.versions?.sort((a, b) => a.id - b.id);
    const flat = toFlatResponse(request);

    // Display-only enrichment — the stored propertyId/communityId snapshot on
    // RegistrationRequestUnit is untouched; this only resolves current names for a readable label.
    const unitLabels = await this.unitService.findLabelsByIds((flat.selectedUnits ?? []).map((u) => u.unitId));
    flat.selectedUnits = (flat.selectedUnits ?? []).map((u) => ({
      ...u,
      unitNumber: unitLabels[u.unitId]?.unitNumber ?? null,
      propertyName: unitLabels[u.unitId]?.propertyName ?? null,
      communityName: unitLabels[u.unitId]?.communityName ?? null,
    }));

    return flat;
  }

  // `customer: true` was missing here — every post-approval deposit-sub-process method
  // (requestDeposit/verifyDeposit/reject) checks `request.customer` to distinguish "already
  // approved, deposit sub-process in flight" from "legacy pre-approval request", but findOneEntity
  // never loaded the relation needed to answer that. In practice this meant a genuinely-approved
  // request always looked exactly like the "no customer yet" legacy case: verifyDeposit's own doc
  // comment on its `if (request.customer)` branch confirms the else-branch was meant only for that
  // legacy path, not the normal one it was silently taking every time. requestDeposit's own
  // `!request.customer` guard rejected every standalone call for the same reason. Fixed by loading
  // the relation like every other one already listed here.
  private readonly findOneEntityRelations = {
    documents: true,
    demands: true,
    customer: true,
    customerDetails: true,
    companyDetail: true,
    selectedUnitEntries: true,
    propertyBillingEntries: true,
    paymentMethodEntries: true,
    depositEntry: true,
  } as const;

  private async findOneEntity(id: number): Promise<RegistrationRequest> {
    const request = await this.requests.findOne({ where: { id }, relations: this.findOneEntityRelations });
    if (!request) throw new NotFoundException('Registration request not found');
    return request;
  }

  /** Same read as findOneEntity, but scoped to an in-flight transaction's manager — used when a
   *  method needs to hand back the request with its just-written child collections populated
   *  before the transaction commits, so the caller never sees a stale/incomplete read racing a
   *  separate connection against the not-yet-committed write. */
  private async findOneEntityInTransaction(manager: DataSource['manager'], id: number): Promise<RegistrationRequest> {
    const request = await manager.findOne(RegistrationRequest, { where: { id }, relations: this.findOneEntityRelations });
    if (!request) throw new NotFoundException('Registration request not found');
    return request;
  }

  // ── Draft (Path B) ─────────────────────────────────────────────────────────────────────────────

  async createDraft(dto: CreateRegistrationRequestDraftDto, actorId?: number, ip?: string) {
    const { selectedUnits, propertyBilling, paymentMethods, ...rest } = dto;
    const { details: customerDetailFields, rest: afterCustomerFields } = extractCustomerDetailFields(rest);
    const { details: companyDetailFields, rest: ownColumns } = extractCompanyDetailFields(afterCustomerFields);

    return this.dataSource.transaction(async (manager) => {
      const entity = manager.create(RegistrationRequest, {
        ...ownColumns,
        ...(dto.termsAccepted ? { termsAcceptedAt: new Date(), termsAcceptedIp: ip ?? null } : {}),
        channel: dto.channel ?? RegistrationChannel.CS,
        status: RegistrationRequestStatus.DRAFT,
        submittedDate: new Date().toISOString().slice(0, 10),
      });
      const saved = await manager.save(RegistrationRequest, entity);
      saved.businessCode = `REG-${String(saved.id).padStart(4, '0')}`;
      await manager.save(RegistrationRequest, saved);

      await this.upsertCustomerDetails(manager, saved, {
        preferredLanguage: dto.preferredLanguage ?? 'English',
        preferredCommunicationChannel: dto.preferredCommunicationChannel ?? 'Email',
        ...customerDetailFields,
      });
      await this.upsertCompanyDetail(manager, saved, companyDetailFields);
      await this.syncChildCollections(manager, saved, { selectedUnits, propertyBilling, paymentMethods });
      await this.appendVersionSnapshot(manager, saved, 'Draft Created', actorId);

      await this.audit.record({
        moduleName: 'registration-requests',
        entityId: saved.id,
        action: 'CREATE',
        newValue: { status: saved.status, channel: saved.channel },
        performedBy: actorId,
      }, manager);

      const created = await this.findOneEntityInTransaction(manager, saved.id);
      return toFlatResponse(created);
    });
  }

  async updateDraft(id: number, dto: UpdateRegistrationRequestDraftDto, actorId?: number, ip?: string) {
    const request = await this.findOneEntity(id);
    // Also editable while Returned to Resident for Correction — the resident is meant to fix and
    // resubmit through this SAME draft-editing path (see submitForReview's own doc comment on the
    // matching resubmission transition).
    if (
      request.status !== RegistrationRequestStatus.DRAFT &&
      request.status !== RegistrationRequestStatus.RETURNED_TO_RESIDENT
    ) {
      throw new ConflictException('Only a Draft or Returned-to-Resident request can be edited directly');
    }
    const { selectedUnits, propertyBilling, paymentMethods, ...rest } = dto;
    const { details: customerDetailFields, rest: afterCustomerFields } = extractCustomerDetailFields(rest);
    const { details: companyDetailFields, rest: ownColumns } = extractCompanyDetailFields(afterCustomerFields);
    Object.assign(request, ownColumns);

    // Stamp/clear the acceptance record server-side, never trusting a client-sent timestamp/IP —
    // mirrors CCB_Template's behavior: accepting stamps now, un-accepting clears the stamp so a
    // draft never carries stale acceptance evidence for terms the applicant no longer agreed to.
    if (dto.termsAccepted !== undefined) {
      if (dto.termsAccepted && !request.termsAccepted) {
        request.termsAcceptedAt = new Date();
        request.termsAcceptedIp = ip ?? null;
      } else if (!dto.termsAccepted) {
        request.termsAcceptedAt = null;
        request.termsAcceptedIp = null;
      }
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.save(RegistrationRequest, request);
      await this.upsertCustomerDetails(manager, request, customerDetailFields);
      await this.upsertCompanyDetail(manager, request, companyDetailFields);
      await this.syncChildCollections(manager, request, { selectedUnits, propertyBilling, paymentMethods });
      const updated = await this.findOneEntityInTransaction(manager, id);
      return toFlatResponse(updated);
    });
  }

  // ── Path B send-to-resident ────────────────────────────────────────────────────────────────────

  async sendToResident(id: number, dto: ActionByDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (request.status !== RegistrationRequestStatus.DRAFT) {
      throw new ConflictException('Only a Draft request can be sent to the resident');
    }

    return this.dataSource.transaction(async (manager) => {
      request.status = RegistrationRequestStatus.SENT_TO_RESIDENT;
      const saved = await manager.save(RegistrationRequest, request);
      await this.appendHistory(manager, saved, RegistrationWorkflowAction.SENT_TO_RESIDENT, actorId, dto.comments ?? null);
      return saved;
    });
  }

  // ── Submission ──────────────────────────────────────────────────────────────────────────────────

  /** The applicant's initial submission — Draft/Sent-to-Resident -> Pending CS Review — and also
   *  the resident's resubmission after a returnToResident correction request
   *  (Returned to Resident for Correction -> Pending CS Review). This is NOT the deposit gate (spec
   *  §6.9's own note: `requestSecurityDeposit` is the distinct, later CS action). This is the ONE
   *  submission entry point (there is no separate Business Approval stage/submitter to route to
   *  instead) — enforces assertSubmissionComplete (name, units, terms acceptance, unit eligibility)
   *  before letting a request leave Draft, the only backend checkpoint that ever validates a
   *  submission. */
  async submitForReview(id: number, dto: ActionByDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (
      request.status !== RegistrationRequestStatus.DRAFT &&
      request.status !== RegistrationRequestStatus.SENT_TO_RESIDENT &&
      request.status !== RegistrationRequestStatus.RETURNED_TO_RESIDENT
    ) {
      throw new ConflictException(`Cannot submit for review from status "${request.status}"`);
    }
    await this.assertSubmissionComplete(request);
    const isResubmission = request.status === RegistrationRequestStatus.RETURNED_TO_RESIDENT;

    return this.dataSource.transaction(async (manager) => {
      request.status = RegistrationRequestStatus.PENDING_CS_REVIEW;
      const saved = await manager.save(RegistrationRequest, request);
      await this.appendHistory(
        manager,
        saved,
        isResubmission ? RegistrationWorkflowAction.RESUBMITTED : RegistrationWorkflowAction.SUBMITTED_FOR_REVIEW,
        actorId,
        dto.comments ?? null,
      );
      return saved;
    });
  }

  /** The completeness gate for submission (submitForReview) — a registration request must have a
   *  name, at least one selected unit, accepted Terms & Conditions, and every selected unit must be
   *  eligible before it can leave Draft. */
  private async assertSubmissionComplete(request: RegistrationRequest): Promise<void> {
    await this.assertDynamicRequiredFields(request);
    if (!request.selectedUnitEntries?.length) {
      throw new BadRequestException('At least one unit must be selected before a registration request can be submitted');
    }
    if (!request.termsAccepted) {
      throw new BadRequestException('Terms & Conditions must be accepted before a registration request can be submitted');
    }
    await this.assertUnitsEligible(request);
  }

  async returnToResident(id: number, dto: MandatoryCommentActionDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (!CS_REVIEW_STATUSES.includes(request.status)) {
      throw new ConflictException(`Cannot return to resident from status "${request.status}"`);
    }

    return this.dataSource.transaction(async (manager) => {
      request.status = RegistrationRequestStatus.RETURNED_TO_RESIDENT;
      const saved = await manager.save(RegistrationRequest, request);
      await this.appendHistory(manager, saved, RegistrationWorkflowAction.RETURNED_TO_RESIDENT, actorId, dto.comments);
      await this.appendVersionSnapshot(manager, saved, 'Returned to Resident for Correction', actorId);
      return saved;
    });
  }

  private async assertDynamicRequiredFields(request: RegistrationRequest): Promise<void> {
    const details = request.customerDetails;

    // Checked explicitly (doesn't fit the flat field->attribute mapping below) against the same
    // REGISTRATION_NAME_MANDATORY attribute the wizard reads. firstName is now the ONE canonical
    // person-name field for both account types (see RegistrationCustomerDetail's own doc comment)
    // — a Corporate request's Contact Person/Manager on License/Authorized Representative uses
    // the exact same field an Individual applicant does, never a separate contactPersonName check.
    if (await this.attributeService.isMandatory('REGISTRATION_NAME_MANDATORY')) {
      // lastName is deliberately NOT required here — a single-word legal name (e.g. from an
      // Emirates ID with no separate family name) legitimately produces an empty lastName, and
      // that must not block submission. Mirrors the same rule already enforced on the wizard's
      // Next button (useRegistrationCreation.ts's canProceedFromIdentityDocs).
      if (!details?.firstName) {
        throw new BadRequestException('Applicant name is required before a registration request can be submitted');
      }
    }

    for (const spec of DYNAMIC_FIELD_REQUIREMENTS) {
      if (spec.appliesTo && !spec.appliesTo(request)) continue;
      const isMandatory = await this.attributeService.isMandatory(spec.attributeKey);
      if (isMandatory && !details?.[spec.field]) {
        throw new BadRequestException(`${spec.label} is required before a registration request can be submitted`);
      }
    }

    const companyDetails = request.companyDetail;
    for (const spec of COMPANY_DYNAMIC_FIELD_REQUIREMENTS) {
      if (spec.appliesTo && !spec.appliesTo(request)) continue;
      const isMandatory = await this.attributeService.isMandatory(spec.attributeKey);
      if (isMandatory && !companyDetails?.[spec.field]) {
        throw new BadRequestException(`${spec.label} is required before a registration request can be submitted`);
      }
    }
  }

  /** Re-validates every selected unit's eligibility server-side at submit time — the Add Units UI
   *  already checks all of this (owner registered, occupancy, resident-type conflict, tariff,
   *  billing cycle) so a user going through the wizard never sees this fire, but a direct API call
   *  bypassing that UI must not be able to submit a registration against units that wouldn't
   *  actually be billable, legally available, or free of an existing same-type resident. Collects
   *  every unit's issues rather than throwing on the first, so the single resulting error names
   *  every affected unit, not just one.
   *
   *  Owner-registered/occupancy checks only apply to Tenant registrations — an Owner registration
   *  is what CREATES the owner-of-record for a unit, so it can never fail "owner not registered
   *  against this unit" the way a Tenant registration legitimately can. The same-resident-type
   *  conflict check (existing Owner blocks a new Owner, existing Tenant blocks a new Tenant — the
   *  opposite type is always allowed) applies to BOTH resident types, and is the single source of
   *  truth also enforced by Customer.create()'s own uniqueness guard at approval time — see
   *  CustomerService.checkUnitResidentTypeConflicts(). Tariff/billing-cycle checks apply to every
   *  resident type, since both need a billable unit to proceed. */
  private async assertUnitsEligible(request: RegistrationRequest): Promise<void> {
    const units = request.selectedUnitEntries ?? [];
    if (!units.length) return;

    const issues: string[] = [];
    const unitIds = units.map((u) => u.unitId);
    const customerResidentType = this.toCustomerResidentType(request.residentType);

    if (request.residentType === RegistrationResidentType.TENANT) {
      const occupancy = await this.customerService.checkUnitsOpenForTenant(unitIds);
      for (const unit of units) {
        const resolution = occupancy[unit.unitId];
        if (!resolution || !resolution.ownerName) {
          issues.push(`Unit #${unit.unitId}: owner is not registered for this unit.`);
        } else if (!resolution.open) {
          issues.push(`Unit #${unit.unitId}: unit is currently occupied and not available for tenant registration.`);
        }
      }
    }

    const residentConflicts = await this.customerService.checkUnitResidentTypeConflicts(unitIds, customerResidentType);
    for (const unit of units) {
      if (residentConflicts[unit.unitId]) {
        issues.push(`Unit #${unit.unitId}: this unit already has a registered ${request.residentType}.`);
      }
    }

    for (const unit of units) {
      const [tariff, billingCycleConfigured] = await Promise.all([
        this.tariffService.resolveForUnit(unit.unitId),
        this.billingCycleService.resolveForProperty(unit.propertyId),
      ]);
      if (!tariff && !billingCycleConfigured) {
        issues.push(`Unit #${unit.unitId}: billing cycle and tariff are not configured for this unit.`);
      } else if (!billingCycleConfigured) {
        issues.push(`Unit #${unit.unitId}: billing cycle is not configured for this unit.`);
      } else if (!tariff) {
        issues.push(`Unit #${unit.unitId}: tariff is not configured for this unit.`);
      }
    }

    if (issues.length) {
      throw new BadRequestException({
        message: 'One or more selected units are not eligible for registration.',
        issues,
      });
    }
  }

  // ── Deposit gate — spec §6.3 ────────────────────────────────────────────────────────────────────

  private mapResident(resident: RegistrationResidentType): RegistrationDocumentResident {
    return resident as unknown as RegistrationDocumentResident;
  }

  /**
   * RegistrationResidentType ('Owner'/'Tenant', capitalized) and Customer's own ResidentType
   * ('owner'/'tenant', lowercase) are two genuinely different-valued enums for the same concept —
   * unlike every other RegistrationXxx/CustomerXxx pair this file maps (accountType, contactType,
   * legalStructure), which share identical runtime string values and are safe to `as unknown as`
   * cast. A blind cast here previously left the wrong-case string flowing straight into
   * CreateCustomerDto.residentType with zero runtime validation (approve() builds that DTO
   * in-process and calls customerService.create() directly, never through the HTTP layer's
   * ValidationPipe, so @IsEnum(ResidentType) never got a chance to catch it) — masked from causing
   * visibly duplicate rows only because the resident_type MySQL column's default collation
   * (utf8mb4_0900_ai_ci) is case-insensitive, so 'Tenant' vs 'tenant' silently matched the same row
   * anyway in most comparisons. This is the ONE place that conversion happens — never re-derive it
   * ad hoc at another call site.
   */
  private toCustomerResidentType(resident: RegistrationResidentType): ResidentType {
    return resident.toLowerCase() as ResidentType;
  }

  private mapAccount(account: RegistrationAccountType): RegistrationDocumentAccountType {
    return account as unknown as RegistrationDocumentAccountType;
  }

  async previewDeposit(id: number) {
    const request = await this.findOneEntity(id);
    return this.buildDemandComponents(request, []);
  }

  private async buildDemandComponents(
    request: RegistrationRequest,
    optionalComponents: string[],
  ): Promise<{
    components: RegistrationDemandComponent[];
    guard: string | null;
    /** Per-unit tariff-resolution failures — populated alongside `guard` (which only ever carries
     *  a single summary string) so callers that need to attribute the failure to a specific unit,
     *  e.g. the Add Units UI marking exactly the affected unit card, don't have to re-derive it. */
    unitIssues: Array<{ unitId: number; issue: 'tariff' }>;
  }> {
    const units = request.selectedUnitEntries ?? [];
    if (!units.length) {
      return { components: [], guard: 'No units selected on this registration request', unitIssues: [] };
    }

    // Owner and Tenant are independently configurable — neither is derived from the other, and
    // neither is hardcoded. This replaced a single global SECURITY_DEPOSIT_MANDATORY flag (plus a
    // narrower OWNER_LEASEOUT_DEPOSIT_ENABLED override) that couldn't express "required for
    // Tenants but not Owners" or vice versa.
    const securityDepositMandatory =
      request.residentType === RegistrationResidentType.OWNER
        ? await this.attributeService.isMandatory('SECURITY_DEPOSIT_MANDATORY_OWNER')
        : await this.attributeService.isMandatory('SECURITY_DEPOSIT_MANDATORY_TENANT');
    const activationFeeMandatory = await this.attributeService.isMandatory('ACTIVATION_FEE_MANDATORY');

    // Leaseout-vs-occupied Owner is a PRICING distinction only (which tariff amount applies below)
    // — never a required/not-required distinction, which is decided by residentType alone above.
    const isOwnerLeaseout =
      request.residentType === RegistrationResidentType.OWNER && request.isResident === false;

    const wantDeposit =
      securityDepositMandatory ||
      optionalComponents.includes(RegistrationDemandComponentType.SECURITY_DEPOSIT);
    const wantActivation =
      activationFeeMandatory ||
      optionalComponents.includes(RegistrationDemandComponentType.ACTIVATION_FEE);

    if (!wantDeposit && !wantActivation) {
      return { components: [], guard: null, unitIssues: [] };
    }

    const components: RegistrationDemandComponent[] = [];
    const unitIssues: Array<{ unitId: number; issue: 'tariff' }> = [];
    for (const unit of units) {
      const tariff = await this.tariffService.resolveForUnit(unit.unitId);
      if (!tariff) {
        // Collect every unit missing a tariff rather than stopping at the first — the Add Units UI
        // shows one card per selected unit and needs to flag each affected one independently.
        unitIssues.push({ unitId: unit.unitId, issue: 'tariff' });
        continue;
      }

      const vatApplicableFees = tariff.vatApplicableFees ?? [];

      if (wantDeposit) {
        const amount = isOwnerLeaseout
          ? Number(tariff.ownerLeaseoutSecurityDeposit)
          : Number(tariff.securityDeposit);
        // Security deposit is always VAT-exempt per the locked SECURITY_DEPOSIT_VAT system
        // attribute (UAE FTA regulation) — never per-tariff-configurable.
        components.push({
          unitId: unit.unitId,
          tariffCode: tariff.master?.businessCode ?? `TAR-${tariff.id}`,
          type: RegistrationDemandComponentType.SECURITY_DEPOSIT,
          amount,
          vatApplicable: false,
          vatAmount: 0,
          refundable: true,
        });
      }

      if (wantActivation) {
        const amount = Number(tariff.activationFee);
        const vatApplicable = vatApplicableFees.includes('activationFee');
        const vatAmount = vatApplicable ? Math.round(amount * (Number(tariff.vat) / 100) * 100) / 100 : 0;
        components.push({
          unitId: unit.unitId,
          tariffCode: tariff.master?.businessCode ?? `TAR-${tariff.id}`,
          type: RegistrationDemandComponentType.ACTIVATION_FEE,
          amount,
          vatApplicable,
          vatAmount,
          refundable: false,
        });
      }
    }

    if (unitIssues.length) {
      const guard =
        unitIssues.length === 1
          ? `No active tariff resolves for unit #${unitIssues[0].unitId} — the demand cannot be raised until one does`
          : `No active tariff resolves for units #${unitIssues.map((i) => i.unitId).join(', #')} — the demand cannot be raised until they do`;
      return { components: [], guard, unitIssues };
    }

    return { components, guard: null, unitIssues: [] };
  }

  /** Upserts the request's single deposit-state row — RegistrationDeposit is a OneToOne, so the
   *  first call (from requestDeposit) creates it and every later state change (payment recorded,
   *  verified, reset on rejection) updates the same row rather than creating a new one. */
  private async upsertDeposit(
    manager: DataSource['manager'],
    request: RegistrationRequest,
    changes: Partial<Pick<RegistrationDeposit, 'amount' | 'status' | 'paymentMethod' | 'paymentReference' | 'paidAt'>>,
  ): Promise<RegistrationDeposit> {
    const existing = request.depositEntry ?? (await manager.findOne(RegistrationDeposit, { where: { request: { id: request.id } } }));
    const deposit = existing ?? manager.create(RegistrationDeposit, { request, amount: 0, status: RegistrationDepositPaymentStatus.PENDING });
    Object.assign(deposit, changes);
    const saved = await manager.save(RegistrationDeposit, deposit);
    request.depositEntry = saved;
    return saved;
  }

  /**
   * The deposit gate now runs AFTER Supervisor Approval, never before — the Customer account
   * already exists by the time this is called. Shared by `approve()` (the automatic, unconditional
   * check that fires immediately once a Customer is created) and `requestDeposit()` (a manual
   * re-trigger for an already-approved request, e.g. re-raising a reversed demand). Runs and saves
   * within the CALLER's transaction (`manager` passed through) so Customer creation and the
   * resulting deposit decision are one atomic unit of work.
   *
   * Returns the deposit-decision alongside the saved request (rather than just the request) so
   * every caller can emit CUSTOMER_ACTIVATION_REQUIRED_EVENT — the trigger for the customer's
   * activation email — with the right `depositAmount` after ITS OWN transaction has committed.
   * `depositAmount` is undefined when no deposit was required (the "activate now" email) and set
   * when one was just raised (the "set password & pay deposit" email); the two are never both
   * relevant for a single call, so this single optional field is enough for the caller to decide.
   */
  private async raiseDepositDemandIfRequired(
    manager: DataSource['manager'],
    request: RegistrationRequest,
    optionalComponents: string[],
    actorId: number | undefined,
  ): Promise<{ request: RegistrationRequest; depositAmount?: number }> {
    const { components, guard } = await this.buildDemandComponents(request, optionalComponents);
    if (guard) throw new BadRequestException(guard);

    if (!components.length) {
      request.depositStatus = RegistrationDepositStatus.NOT_REQUIRED;
      request.activationInviteStatus = ActivationInviteStatus.PENDING_INVITE;
      const saved = await manager.save(RegistrationRequest, request);
      await this.appendHistory(manager, saved, RegistrationWorkflowAction.SECURITY_DEPOSIT_NOT_REQUIRED, actorId, null);
      return { request: saved };
    }

    const subtotal = components.reduce((sum, c) => sum + c.amount, 0);
    const vatTotal = components.reduce((sum, c) => sum + c.vatAmount, 0);
    const total = subtotal + vatTotal;

    const demand = manager.create(RegistrationDemand, {
      request,
      demandNumber: '',
      components,
      subtotal,
      vatTotal,
      total,
      status: RegistrationDemandStatus.RAISED,
      raisedDate: new Date(),
    });
    const savedDemand = await manager.save(RegistrationDemand, demand);
    savedDemand.demandNumber = `RDM-${String(savedDemand.id).padStart(6, '0')}`;
    await manager.save(RegistrationDemand, savedDemand);

    // `request.demands` was loaded by findOneEntity() BEFORE this demand existed, so it's missing
    // from that in-memory array. `demands` cascades (see registration-request.entity.ts), and the
    // save() below re-saves `request` — without this push, TypeORM's cascade sees the just-created
    // demand "missing" from the collection it's cascading and nulls its request_id FK to match,
    // throwing "Column 'request_id' cannot be null" on its own very next UPDATE. Keeping the
    // in-memory collection in sync with what's actually in the DB is what stops the cascade from
    // "reconciling" a child it never knew about out of the relation.
    request.demands = [...(request.demands ?? []), savedDemand];

    // Deliberately NOT stamping activationInviteStatus here — the account must not be treated as
    // ready for activation until the required deposit is actually paid and verified (see
    // verifyDeposit()'s own success path, the only other place this gets stamped). Also deliberately
    // NOT touching `request.status` — the deposit sub-process lives entirely on `depositStatus` now;
    // the workflow status stays APPROVED throughout the whole deposit sub-process (see
    // RegistrationDepositStatus's own doc comment for why this split exists).
    request.depositStatus = RegistrationDepositStatus.REQUESTED;
    const saved = await manager.save(RegistrationRequest, request);
    await this.upsertDeposit(manager, saved, { amount: total });
    await this.appendHistory(manager, saved, RegistrationWorkflowAction.SECURITY_DEPOSIT_REQUESTED, actorId, null);

    return { request: saved, depositAmount: total };
  }

  /** Manual re-trigger only — approve() already runs this automatically the moment the Customer is
   *  created. Gated to an already-approved request with no demand currently in flight, so it can
   *  never fire before approval (the deposit gate's whole point) nor duplicate a live demand. Now
   *  that `status` stays APPROVED throughout the whole deposit sub-process (see
   *  RegistrationDepositStatus's own doc comment), `status === APPROVED` alone no longer implies "no
   *  demand in flight" the way it used to — the explicit `depositStatus` check is what does that. */
  async requestDeposit(id: number, dto: RequestDepositDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (!request.customer || request.status !== RegistrationRequestStatus.APPROVED) {
      throw new ConflictException(`Cannot request a deposit from status "${request.status}"`);
    }
    if (request.depositStatus === RegistrationDepositStatus.REQUESTED || request.depositStatus === RegistrationDepositStatus.PAID_PENDING_VERIFICATION) {
      throw new ConflictException(`A deposit is already in progress (${request.depositStatus})`);
    }

    const result = await this.dataSource.transaction((manager) =>
      this.raiseDepositDemandIfRequired(manager, request, dto.optionalComponents ?? [], actorId),
    );

    // Same ordering rule as approve() — emitted only after the transaction above has committed.
    this.events.emit(
      CUSTOMER_ACTIVATION_REQUIRED_EVENT,
      new CustomerActivationRequiredEvent(request.customer!.id, result.depositAmount),
    );

    return result.request;
  }

  /**
   * The read side of the registration/deposit sub-process for a Customer — used by
   * CustomerService.activate() (via `isDepositResolved` on `depositStatus` alone — accountStatus
   * isn't meaningful yet at that call site, it's mid-write) and by CustomerAccessGuard/AuthService.
   * bootstrap (via `computePortalAccess` on both fields together — see that function's own doc
   * comment for why Verified alone isn't enough). Deliberately a single raw minimal query (not
   * findOne/findAll, which eager-load documents/demands/etc. neither caller needs) joining in
   * `customer.accountStatus` alongside `depositStatus` so both callers get everything in ONE
   * round-trip rather than two — this runs on every single guarded request for a Customer session,
   * so it stays as cheap as the two columns it actually reads. A customer with no registration
   * request at all (should not exist in practice — Customer rows are only ever created via
   * approve()) resolves both fields to `null` — fail closed, never fail open, at every caller.
   */
  async getMyDepositStatus(customerId: number): Promise<{ depositStatus: RegistrationDepositStatus | null; accountStatus: string | null }> {
    const row = await this.requests
      .createQueryBuilder('r')
      .select('r.depositStatus', 'depositStatus')
      .addSelect('customer.accountStatus', 'accountStatus')
      .innerJoin('r.customer', 'customer')
      .where('customer.id = :customerId', { customerId })
      .getRawOne<{ depositStatus: RegistrationDepositStatus | null; accountStatus: string | null }>();
    return { depositStatus: row?.depositStatus ?? null, accountStatus: row?.accountStatus ?? null };
  }

  /**
   * THE single definition of "the currently payable demand" for a registration request — every
   * caller that needs to know which demand a new payment should target (recordDepositPayment) or
   * which demand the Customer-facing GET should surface as active (CustomerPortalService.
   * getMySecurityDeposit) MUST go through this, never re-derive it independently (e.g. "last item
   * in the array", "first item", "most recently created") — that divergence is exactly what let the
   * GET side and the POST side disagree after a re-demand. At most one demand can ever be RAISED at
   * a time (raiseDepositDemandIfRequired only ever creates a new one after the prior one has moved
   * to PAID/VERIFIED/REVERSED), so `.find(...)` here is unambiguous by construction, not a
   * heuristic.
   */
  resolveActiveDemand(request: { demands?: RegistrationDemand[] }): RegistrationDemand | undefined {
    return (request.demands ?? []).find((d) => d.status === RegistrationDemandStatus.RAISED);
  }

  /** `isCustomerInitiated` is set only by CustomerPortalService.payMySecurityDeposit — this is the
   *  ONE call site reachable by both a staff actor (existing path, `actorId` a real `users.id`) and
   *  the customer themselves (the new self-service path, no `actorId` at all — a Customer's id is
   *  a different id space and must never be passed where a staff actor id is expected, per this
   *  codebase's own established rule; see RefreshToken.principalType's own doc comment on that
   *  exact class of bug). Recording "Customer (self-service)" rather than silently falling back to
   *  actorLabel's generic "System" keeps the audit trail honest about who actually took the action. */
  async recordDepositPayment(id: number, dto: RecordDepositPaymentDto, actorId?: number, isCustomerInitiated = false) {
    const request = await this.findOneEntity(id);
    if (
      request.depositStatus !== RegistrationDepositStatus.REQUESTED &&
      request.status !== RegistrationRequestStatus.RETURNED_TO_RESIDENT
    ) {
      throw new ConflictException(`Cannot record a deposit payment from deposit status "${request.depositStatus}"`);
    }
    const demand = this.resolveActiveDemand(request);
    if (!demand) {
      this.logger.warn(
        `recordDepositPayment: no RAISED demand for request #${id} (depositStatus="${request.depositStatus}", ` +
          `demandIds/statuses=${JSON.stringify((request.demands ?? []).map((d) => ({ id: d.id, status: d.status })))})`,
      );
      throw new ConflictException('No raised demand to record payment against');
    }
    this.logger.log(`recordDepositPayment: request #${id} paying against demand #${demand.id} (${demand.demandNumber})`);

    return this.dataSource.transaction(async (manager) => {
      demand.status = RegistrationDemandStatus.PAID;
      demand.paidDate = new Date();
      demand.paymentMethod = dto.paymentMethod;
      demand.paymentReference = dto.paymentReference;
      demand.receiptDocRef = dto.receiptFileRef ?? null;
      demand.receiptDataUrl = dto.receiptDataUrl ?? null;
      await manager.save(RegistrationDemand, demand);

      request.depositStatus = RegistrationDepositStatus.PAID_PENDING_VERIFICATION;
      const saved = await manager.save(RegistrationRequest, request);
      await this.upsertDeposit(manager, saved, {
        status: RegistrationDepositPaymentStatus.PAID,
        paymentMethod: dto.paymentMethod,
        paymentReference: dto.paymentReference,
        paidAt: new Date(),
      });

      const entry = manager.create(RegistrationWorkflowHistoryEntry, {
        request: saved,
        actionType: RegistrationWorkflowAction.DEPOSIT_PAID,
        actionBy: isCustomerInitiated ? 'Customer (self-service)' : actorLabel(actorId),
        actionAt: new Date(),
        comments: dto.comments ?? null,
      });
      await manager.save(RegistrationWorkflowHistoryEntry, entry);

      return saved;
    });
  }

  async verifyDeposit(id: number, dto: ActionByDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (request.depositStatus !== RegistrationDepositStatus.PAID_PENDING_VERIFICATION) {
      throw new ConflictException(`Cannot verify a deposit from deposit status "${request.depositStatus}"`);
    }
    const demand = (request.demands ?? []).find((d) => d.status === RegistrationDemandStatus.PAID);
    if (!demand) throw new ConflictException('No paid demand to verify');

    return this.dataSource.transaction(async (manager) => {
      demand.status = RegistrationDemandStatus.VERIFIED;
      demand.verifiedDate = new Date();
      await manager.save(RegistrationDemand, demand);

      request.depositStatus = RegistrationDepositStatus.VERIFIED;

      // The deposit gate runs strictly after approval (approve() both creates the Customer AND, in
      // the same transaction, raises the deposit demand that eventually reaches PAID_PENDING_
      // VERIFICATION here — see approve()'s own doc comment) — a demand cannot exist at all unless
      // `request.customer` was already set, so this is never null in practice. The workflow `status`
      // itself never leaves APPROVED throughout the whole deposit sub-process (see
      // RegistrationDepositStatus's own doc comment) — this only marks the account ready for the
      // (follow-up) activation invite and flips accountStatus to ACTIVE.
      request.activationInviteStatus = ActivationInviteStatus.PENDING_INVITE;
      // THE flip from INACTIVE to ACTIVE for a Customer whose deposit WAS required — the
      // "Not Required" case already activated immediately at CustomerService.activate() time (see
      // that method's own doc comment); this is the other half of the same corrected rule
      // (Supervisor Approved must NOT mean fully Active — only a verified-or-not-required deposit
      // does). Same transaction/manager as everything else here, never a separate commit — deposit
      // Verified and account Active must reach the DB atomically together.
      await this.customerService.activateFromDepositVerification(request.customer!.id, manager);
      const saved = await manager.save(RegistrationRequest, request);
      await this.appendHistory(manager, saved, RegistrationWorkflowAction.DEPOSIT_VERIFIED, actorId, dto.comments ?? null);
      return saved;
    });
  }

  /**
   * The Supervisor's "cancel/reject the payment" verification action. Previously this only reset
   * `depositStatus` back to REQUESTED without touching the demand the customer had just paid
   * against — that demand stayed stuck at `Paid` forever, so the next `recordDepositPayment` call
   * (which only ever looks for a demand with `status === RAISED`, per that method's own doc
   * comment) found nothing and threw "No raised demand to record payment against", even though the
   * UI still showed the old (stale) demand's amount as due. Same drift-between-demand-and-deposit
   * bug `reject()` already fixes for its own (legacy, pre-approval) reversal path — see that
   * method's own comment on `DEMAND_REVERSED` — just never applied here.
   *
   * Fixed by actually reversing the paid demand (REVERSED, matching `reject()`'s precedent) and
   * re-raising a fresh one through the SAME `raiseDepositDemandIfRequired` logic every other
   * demand-creation path already uses — no separate demand-creation code, no duplicate demands (the
   * old one is terminal at `Reversed` and `recordDepositPayment`/`verifyDeposit` only ever look at
   * `RAISED`/`PAID` demands respectively, so a `Reversed` demand can never be paid or verified
   * again).
   */
  async returnReceiptForCorrection(id: number, dto: MandatoryCommentActionDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (request.depositStatus !== RegistrationDepositStatus.PAID_PENDING_VERIFICATION) {
      throw new ConflictException(`Cannot return a receipt from deposit status "${request.depositStatus}"`);
    }

    return this.dataSource.transaction(async (manager) => {
      const paidDemand = (request.demands ?? []).find((d) => d.status === RegistrationDemandStatus.PAID);
      if (paidDemand) {
        this.logger.log(`returnReceiptForCorrection: request #${id} reversing demand #${paidDemand.id} (${paidDemand.demandNumber})`);
        paidDemand.status = RegistrationDemandStatus.REVERSED;
        await manager.save(RegistrationDemand, paidDemand);
        await this.upsertDeposit(manager, request, { status: RegistrationDepositPaymentStatus.PENDING });
        await this.appendHistory(manager, request, RegistrationWorkflowAction.DEMAND_REVERSED, actorId, null);
      } else {
        this.logger.warn(`returnReceiptForCorrection: request #${id} had no PAID demand to reverse`);
      }

      await this.appendHistory(manager, request, RegistrationWorkflowAction.RETURNED_TO_RESIDENT, actorId, dto.comments);

      // Re-raises through the exact same path requestDeposit()/approve() use — one fresh RAISED
      // demand, depositStatus back to REQUESTED, the deposit row upserted to match. No new email is
      // sent here (unlike requestDeposit's manual re-trigger) — this is a correction of an existing
      // in-flight deposit, not a new activation-invite-triggering event.
      const result = await this.raiseDepositDemandIfRequired(manager, request, [], actorId);
      const newDemand = this.resolveActiveDemand(result.request);
      this.logger.log(
        `returnReceiptForCorrection: request #${id} re-raised demand #${newDemand?.id} (${newDemand?.demandNumber}) ` +
          `— depositStatus now "${result.request.depositStatus}"`,
      );
      return result.request;
    });
  }

  // ── Approval / rejection ───────────────────────────────────────────────────────────────────────
  // The Registration Approval queue's own approve/reject decision, reachable from CS_REVIEW_STATUSES
  // (currently just PENDING_CS_REVIEW — see that constant's own doc comment) via
  // REGISTRATION_APPROVAL_APPROVE/REGISTRATION_APPROVAL_REJECT (see registration-request.controller.
  // ts's OR-permission decorators, which also still accept the older APPROVE_REGISTRATION_REQUEST/
  // REJECT_REGISTRATION_REQUEST codes as alternates — kept for backward compatibility with any role
  // already granted those, never removed just because the flow that originally motivated them
  // — a separate "Business Approval" stage sitting between CS review and this decision — no longer
  // exists). There is only ever ONE approval decision now, made directly from the CS review queue;
  // no separate Business Approval stage/status sits between submission and this call.
  private readonly APPROVABLE_FROM_STATUSES: RegistrationRequestStatus[] = [...CS_REVIEW_STATUSES];

  /**
   * Business flow (spec): Pending CS Review -> Supervisor Approves -> Customer Account Created ->
   * Security Deposit Required? -> Yes: Deposit Demand Created (awaiting payment/verification) ->
   * No: account ready for the (follow-up) activation invite immediately.
   *
   * The Customer account is created UNCONDITIONALLY here, before the deposit question is even
   * asked — approval and account creation are not gated on the deposit outcome, only the
   * activation-ready signal (`activationInviteStatus`) is. This also means "App Account" and "Unit
   * Account" were never two separate concepts to begin with: `customerService.create()` has
   * always produced exactly one Customer row per (unit, residentType) — there is nothing here to
   * split or reconcile between "app" and "unit", just the one account.
   *
   * `request.depositStatus` may move through REQUESTED/PAID_PENDING_VERIFICATION/VERIFIED
   * immediately after this call returns — that is the deposit sub-flow now running AFTER approval,
   * entirely on its own column (see RegistrationDepositStatus), never re-entering `request.status`
   * itself, which stays APPROVED throughout. `request.customer != null` (checked below, and by
   * every other guard in this file that needs to distinguish "approved" from "not yet approved") is
   * the one true signal for "has approval happened".
   */
  async approve(id: number, dto: ActionByDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (!this.APPROVABLE_FROM_STATUSES.includes(request.status)) {
      throw new ConflictException(`Cannot approve from status "${request.status}"`);
    }
    if (request.customer) {
      // Already approved once — idempotency guard (spec §12).
      return request;
    }

    const createDto = this.toCreateCustomerDto(request);
    const createCompanyDto = this.toCreateCompanyDto(request);

    return this.dataSource.transaction(async (manager) => {
      // Pass THIS transaction's manager through — customerService.create() no longer opens its own
      // independent transaction when one is supplied, so the Customer insert (and, for a Corporate
      // request, the linked Company insert — see CustomerService.createWithManager) is now part of
      // the SAME atomic unit of work as everything else in this approve() call. If any later step
      // here (raiseDepositDemandIfRequired, appendHistory, audit.record) throws, the customer (and
      // company) row rolls back too, instead of staying committed as an orphan with no linked,
      // approved request.
      const customer = await this.customerService.create(createDto, actorId, manager, createCompanyDto);

      // A demand already VERIFIED here means this request entered its deposit flow before this
      // change (the legacy pre-approval path) and is only now reaching approve() — carry its id
      // onto the new customer exactly as before. In the normal (new) flow no demand exists yet at
      // this point, so this is always undefined and raiseDepositDemandIfRequired below is what
      // actually raises one.
      const verifiedDemand = (request.demands ?? []).find((d) => d.status === RegistrationDemandStatus.VERIFIED);
      request.customer = customer;
      request.status = RegistrationRequestStatus.APPROVED;
      // A verified demand here is the legacy pre-approval path's deposit — stamp depositStatus to
      // match immediately, since the `if (!verifiedDemand)` branch below (which would otherwise set
      // it) is skipped entirely in this case.
      if (verifiedDemand) request.depositStatus = RegistrationDepositStatus.VERIFIED;
      let saved = await manager.save(RegistrationRequest, request);

      if (verifiedDemand) {
        customer.registrationDemandId = verifiedDemand.id;
        await manager.save(customer);
      }

      await this.appendHistory(manager, saved, RegistrationWorkflowAction.BUSINESS_APPROVED, actorId, dto.comments ?? null);

      // Security Deposit happens ONLY after Supervisor Approval — checked here, immediately after
      // the Customer row exists, never before. Skipped entirely if a demand was already verified
      // pre-approval (the legacy path above) — that request already went through this decision (and
      // already sent whatever activation email applied back then), so `sendActivationEmail` stays
      // false in that branch — never a second email for the same customer from this same approve().
      let sendActivationEmail = false;
      let depositAmount: number | undefined;
      if (!verifiedDemand) {
        const result = await this.raiseDepositDemandIfRequired(manager, saved, [], actorId);
        saved = result.request;
        depositAmount = result.depositAmount;
        sendActivationEmail = true;
      }

      await this.audit.record({
        moduleName: 'registration-requests',
        entityId: saved.id,
        action: 'APPROVE',
        newValue: { customerId: customer.id },
        performedBy: actorId,
      }, manager);

      return { request: saved, customer, sendActivationEmail, depositAmount };
    }).then((result) => {
      // Emitted only after the transaction above has fully committed — see
      // CustomerActivationListener's own doc comment for why this ordering is what keeps an SMTP
      // failure from ever being able to affect the approval transaction itself.
      if (result.sendActivationEmail) {
        this.events.emit(
          CUSTOMER_ACTIVATION_REQUIRED_EVENT,
          new CustomerActivationRequiredEvent(result.customer.id, result.depositAmount),
        );
      }
      return { request: result.request, customer: result.customer };
    });
  }

  async reject(id: number, dto: MandatoryCommentActionDto, actorId?: number) {
    const request = await this.findOneEntity(id);
    if (!this.APPROVABLE_FROM_STATUSES.includes(request.status)) {
      throw new ConflictException(`Cannot reject from status "${request.status}"`);
    }
    if (request.customer) {
      // Already approved — the deposit gate now runs post-approval, so request.depositStatus can be
      // mid-progress (REQUESTED/PAID_PENDING_VERIFICATION/VERIFIED) for an already-approved request
      // (see approve()'s own doc comment). Rejecting an approved request/existing Customer is out of
      // scope here — never let a post-approval deposit hiccup masquerade as a rejection.
      throw new ConflictException('Cannot reject an already-approved registration request');
    }

    return this.dataSource.transaction(async (manager) => {
      // request.customer is guaranteed null here (guard above), so depositStatus is normally still
      // null too under the current (post-approval-only) deposit gate — a demand found at this point
      // is only possible for legacy data that entered the deposit flow before that change.
      const demand = (request.demands ?? []).find(
        (d) => d.status === RegistrationDemandStatus.RAISED || d.status === RegistrationDemandStatus.PAID || d.status === RegistrationDemandStatus.VERIFIED,
      );
      if (demand) {
        demand.status = RegistrationDemandStatus.REVERSED;
        await manager.save(RegistrationDemand, demand);
        // The deposit's own status previously stayed stuck at "Paid" forever after a rejection,
        // disagreeing with the demand it was paid against (now Reversed) — reset it back to
        // Pending alongside the demand so the two never drift apart.
        if (request.depositEntry && request.depositEntry.status === RegistrationDepositPaymentStatus.PAID) {
          await this.upsertDeposit(manager, request, { status: RegistrationDepositPaymentStatus.PENDING });
        }
        request.depositStatus = null;
        await this.appendHistory(manager, request, RegistrationWorkflowAction.DEMAND_REVERSED, actorId, null);
      }

      request.status = RegistrationRequestStatus.REJECTED;
      const saved = await manager.save(RegistrationRequest, request);
      await this.appendHistory(manager, saved, RegistrationWorkflowAction.REJECTED, actorId, dto.comments);
      return saved;
    });
  }

  /**
   * Builds the CreateCustomerDto used at approval time (see approve()). accountStatus is
   * explicitly set to INACTIVE here — the Customer created at approval must not be usable/login-
   * capable until the customer actually completes their own activation (sets their password — see
   * CustomerService.activate(), the only place that flips it to ACTIVE). Without this explicit
   * override, CustomerService.createWithManager()'s own default (ACTIVE, for the standalone
   * `POST /customers` path) would apply here too, which is exactly the bug this override prevents.
   */
  private toCreateCustomerDto(request: RegistrationRequest): CreateCustomerDto {
    const selectedUnits = request.selectedUnitEntries ?? [];
    const primaryUnit = selectedUnits[0];
    if (!primaryUnit) {
      throw new BadRequestException('Cannot approve a registration request with no selected units');
    }
    const details = request.customerDetails;
    if (!details?.email || !details?.mobile) {
      throw new BadRequestException('Cannot approve a registration request with no email or mobile on file');
    }
    const email = details.email;
    const mobile = details.mobile;
    const additionalUnitIds = selectedUnits.slice(1).map((u) => u.unitId);

    return {
      unitId: primaryUnit.unitId,
      additionalUnitIds: additionalUnitIds.length ? additionalUnitIds : undefined,
      accountStatus: CustomerAccountStatus.INACTIVE,
      // firstName/lastName is now the ONE canonical person-name source for both account types
      // (see RegistrationCustomerDetail's own doc comment) — contactPersonName is a legacy
      // fallback ONLY, for a Corporate request created before this field was unified, where
      // firstName/lastName were never populated. New Corporate drafts never populate
      // contactPersonName at all (see extractionDraftPatch/buildDraftPayload), so this fallback
      // is dead weight for any request created after that change but stays exactly-as-is for old
      // pre-existing data — never delete this fallback without confirming no such rows remain.
      fullName:
        request.accountType === RegistrationAccountType.CORPORATE
          ? [details.firstName, details.lastName].filter(Boolean).join(' ') || details.contactPersonName || ''
          : [details.firstName, details.middleName, details.lastName].filter(Boolean).join(' '),
      salutation: details.salutation ?? undefined,
      firstName: details.firstName ?? undefined,
      middleName: details.middleName ?? undefined,
      lastName: details.lastName ?? undefined,
      occupation: details.occupation ?? undefined,
      alternatePhone: details.alternatePhone ?? undefined,
      principalName: details.principalName ?? undefined,
      principalEmail: details.principalEmail ?? undefined,
      principalPhone: details.principalPhone ?? undefined,
      principalIsPrimaryRecipient: details.principalIsPrimaryRecipient ?? undefined,
      propertyDocumentType: details.propertyDocumentType ?? undefined,
      propertyDocumentReference: details.propertyDocumentReference ?? undefined,
      accountType: request.accountType as unknown as CustomerAccountType,
      contactPersonName: details.contactPersonName ?? undefined,
      contactType: details.contactType as unknown as CustomerContactType | undefined,
      residentType: this.toCustomerResidentType(request.residentType),
      isResident: request.isResident ?? undefined,
      gender: details.gender ?? undefined,
      dateOfBirth: details.dateOfBirth ?? undefined,
      nationality: details.nationality ?? undefined,
      maritalStatus: details.maritalStatus ?? undefined,
      photoUrl: details.photoUrl ?? undefined,
      email,
      mobile,
      preferredCommunicationChannel: details.preferredCommunicationChannel,
      preferredLanguage: details.preferredLanguage,
      paymentMethods: (request.paymentMethodEntries ?? []).length
        ? (request.paymentMethodEntries ?? []).map((m) => ({
            id: String(m.id),
            type: m.type,
            maskedIdentifier: m.maskedIdentifier,
            brandOrBank: m.brandOrBank ?? undefined,
            expiry: m.expiry ?? undefined,
            accountHolderName: m.accountHolderName ?? undefined,
            bankName: m.bankName ?? undefined,
            isDefault: m.isDefault,
          }))
        : undefined,
      autoPayEnabled: request.autoPayEnabled ?? undefined,
      propertyBilling: (request.propertyBillingEntries ?? []).length
        ? ((request.propertyBillingEntries ?? []).map((b) => ({
            propertyId: b.propertyId,
            billingType: b.billingType,
          })) as unknown as CreateCustomerDto['propertyBilling'])
        : undefined,
      emergencyContactName: details.emergencyContactName ?? undefined,
      emergencyContactPhone: details.emergencyContactPhone ?? undefined,
      securityDeposit: request.depositEntry ? Number(request.depositEntry.amount) || undefined : undefined,
    };
  }

  /**
   * Builds the CreateCompanyDto used at approval time (see approve()) — the Company-side sibling
   * of toCreateCustomerDto above. Returns `undefined` for an Individual request (accountType !==
   * CORPORATE), which is exactly what tells approve()/CustomerService not to create a Company row
   * at all — an Individual customer never gets one, matching RegistrationCompanyDetail's own
   * row-absence-models-optionality convention. Also returns `undefined` if a Corporate request
   * somehow has no companyDetail row (draft never had any Company field saved) — approval must not
   * fail outright in that case (Company fields aren't validated as submission-blocking beyond the
   * existing DYNAMIC_FIELD_REQUIREMENTS-driven mandatory checks), it simply creates no Company row,
   * same as today's behavior of the fields staying null.
   */
  private toCreateCompanyDto(request: RegistrationRequest): CreateCompanyDto | undefined {
    if (request.accountType !== RegistrationAccountType.CORPORATE) return undefined;
    const company = request.companyDetail;
    if (!company) return undefined;

    return {
      legalStructure: company.legalStructure as unknown as CustomerLegalStructure | undefined,
      companyRegistrationDate: company.companyRegistrationDate ?? undefined,
      companyRegistrationNumber: company.companyRegistrationNumber ?? undefined,
      tradeLicenseNumber: company.tradeLicenseNumber ?? undefined,
      licenseExpiryDate: company.licenseExpiryDate ?? undefined,
      managerName: company.managerName ?? undefined,
      tradeLicenseVerified: company.tradeLicenseVerified ?? undefined,
      trn: company.trn ?? undefined,
      trnExpiryDate: company.trnExpiryDate ?? undefined,
      taxableEntityName: company.taxableEntityName ?? undefined,
      effectiveRegistrationDate: company.effectiveRegistrationDate ?? undefined,
      issuingAuthority: company.issuingAuthority ?? undefined,
      trnVerified: company.trnVerified ?? undefined,
    };
  }

  // ── Documents ──────────────────────────────────────────────────────────────────────────────────

  async uploadDocument(requestId: number, dto: UploadRegistrationDocumentDto, actorId?: number) {
    const request = await this.findOneEntity(requestId);

    let doc = (request.documents ?? []).find(
      (d) => d.type === dto.type && (d.unitId ?? null) === (dto.unitId ?? null),
    );

    if (!doc) {
      doc = this.documents.create({
        request,
        type: dto.type,
        unitId: dto.unitId ?? null,
      });
    }

    doc.status = RegistrationDocumentStatus.VALID;
    doc.uploadedDate = new Date().toISOString().slice(0, 10);
    doc.fileRef = dto.fileRef;
    doc.fileData = dto.fileData ?? null;

    return this.documents.save(doc);
  }

  /**
   * Deletes a single uploaded document — the file only. The unit it belongs to stays selected;
   * removing a Title Deed does not imply the unit should drop out of the registration, it just
   * means that unit now needs a new document uploaded before it can pass validation again.
   */
  async removeDocument(requestId: number, docType: string, unitId?: number) {
    const request = await this.findOneEntity(requestId);
    const doc = (request.documents ?? []).find(
      (d) => d.type === docType && (d.unitId ?? null) === (unitId ?? null),
    );
    if (!doc) throw new NotFoundException('Document not found on this registration request');

    await this.documents.remove(doc);
  }

  async toggleExtractedFieldVerified(
    requestId: number,
    docType: string,
    fieldName: string,
    dto: ToggleExtractedFieldVerifiedDto,
  ) {
    const request = await this.findOneEntity(requestId);
    const doc = (request.documents ?? []).find(
      (d) => d.type === docType && (d.unitId ?? null) === (dto.unitId ?? null),
    );
    if (!doc) throw new NotFoundException('Document not found on this registration request');

    const fields = doc.extractedFields ?? [];
    const field = fields.find((f) => f.fieldName === fieldName);
    if (!field) throw new NotFoundException('Extracted field not found on this document');

    field.verified = dto.verified;
    doc.extractedFields = fields;
    return this.documents.save(doc);
  }

  /**
   * Verifies (or un-verifies) every extracted field on a document in ONE write — the "Verified"
   * checkbox's actual write path. Doing this as N sequential toggleExtractedFieldVerified calls
   * left a real gap: an interrupted loop (navigation away, a dropped connection mid-sequence)
   * could leave some fields verified and others not, with no way back to a consistent state short
   * of re-uploading. A single save is atomic with respect to this document's row.
   */
  async setAllExtractedFieldsVerified(
    requestId: number,
    docType: string,
    dto: ToggleExtractedFieldVerifiedDto,
  ) {
    const request = await this.findOneEntity(requestId);
    const doc = (request.documents ?? []).find(
      (d) => d.type === docType && (d.unitId ?? null) === (dto.unitId ?? null),
    );
    if (!doc) throw new NotFoundException('Document not found on this registration request');

    const fields = doc.extractedFields ?? [];
    doc.extractedFields = fields.map((f) => ({ ...f, verified: dto.verified }));
    return this.documents.save(doc);
  }

  /**
   * Persists a document's full extracted-field set — the single write path for OCR and manual-
   * entry results alike (source doesn't matter to storage). Always sets verified: false on every
   * field, even when overwriting an existing set — replacing the fields is itself an edit that
   * should be re-verified, never silently inherit a stale attestation.
   */
  async setExtractedFields(requestId: number, docType: string, dto: SetExtractedFieldsDto) {
    const request = await this.findOneEntity(requestId);
    const doc = (request.documents ?? []).find(
      (d) => d.type === docType && (d.unitId ?? null) === (dto.unitId ?? null),
    );
    if (!doc) throw new NotFoundException('Document not found on this registration request');

    doc.extractedFields = dto.fields.map((f) => ({
      fieldName: f.fieldName,
      extractedValue: f.extractedValue ?? null,
      confidence: f.confidence ?? null,
      verified: false,
    }));
    return this.documents.save(doc);
  }

  /**
   * Edits a single extracted field's value — the manual-data-entry write path (OCR-Based Data
   * Entry = No), and the correction path for a poor OCR/simulated read. Clears verified so an edit
   * always forces a re-confirm, mirroring toggleExtractedFieldVerified's own discipline.
   */
  async setExtractedFieldValue(
    requestId: number,
    docType: string,
    fieldName: string,
    dto: SetExtractedFieldValueDto,
  ) {
    const request = await this.findOneEntity(requestId);
    const doc = (request.documents ?? []).find(
      (d) => d.type === docType && (d.unitId ?? null) === (dto.unitId ?? null),
    );
    if (!doc) throw new NotFoundException('Document not found on this registration request');

    const fields = doc.extractedFields ?? [];
    const field = fields.find((f) => f.fieldName === fieldName);
    if (!field) throw new NotFoundException('Extracted field not found on this document');

    field.extractedValue = dto.extractedValue ?? null;
    field.verified = false;
    doc.extractedFields = fields;
    return this.documents.save(doc);
  }

  // ── Registration Document Set Definition — applicable rules for this request's profile ─────────

  async getApplicableDocumentRules(requestId: number) {
    const request = await this.findOneEntity(requestId);
    const query: ApplicableDocumentRuleQueryDto = {
      residentType: this.mapResident(request.residentType) as
        | RegistrationDocumentResident.OWNER
        | RegistrationDocumentResident.TENANT,
      accountType: this.mapAccount(request.accountType) as
        | RegistrationDocumentAccountType.INDIVIDUAL
        | RegistrationDocumentAccountType.CORPORATE,
      contactType: request.customerDetails?.contactType
        ? (request.customerDetails.contactType as unknown as RegistrationDocumentContactType)
        : undefined,
    };
    return this.documentRules.getApplicableRules(query);
  }
}

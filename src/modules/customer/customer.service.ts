import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RegistrationRequestService } from '../registration-request/registration-request.service';
import { isDepositResolved } from '../registration-request/entities/registration-request.entity';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { generateSecureToken, hashSecureToken, parseExpiryDuration } from '../../common/utils/secure-token.util';
import { MailService } from '../../mail/mail.service';
import { customerActivationTemplate } from '../../mail/templates/customer-activation.template';
import { securityDepositPaymentTemplate } from '../../mail/templates/security-deposit-payment.template';
import { UnitService } from '../unit/unit.service';
import { ActivateCustomerDto } from './dto/activate-customer.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import {
  CreateCustomerDto,
  CreateCompanyDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/create-customer.dto';
import { CustomerDetailDto, CustomerListDto, UnitCustomerSummaryDto } from './dto/customer-response.dto';
import { CustomerActivationToken } from './entities/customer-activation-token.entity';
import { Customer, CustomerAccountStatus, CustomerAccountType, ResidentType } from './entities/customer.entity';
import { Company } from './entities/company.entity';

export interface UnitOccupancyResolution {
  open: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  reason: string;
}

const PASSWORD_HASH_ROUNDS = 12;

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(CustomerActivationToken)
    private readonly activationTokens: Repository<CustomerActivationToken>,
    @Inject(forwardRef(() => UnitService))
    private readonly units: UnitService,
    @Inject(forwardRef(() => RegistrationRequestService))
    private readonly registrationRequests: RegistrationRequestService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `manager` is optional — pass the CALLER's own transaction manager (e.g.
   * RegistrationRequestService.approve()'s) so this insert lives inside that caller's atomic unit
   * of work instead of committing independently. Without this, a customer row created here could
   * commit permanently even when the surrounding operation (e.g. an approval) subsequently fails
   * and rolls back — producing a real, orphaned Customer with no linked, successfully-approved
   * RegistrationRequest (a genuine incident this codebase hit: a registration stuck at "Pending CS
   * Review" while its Customer row already existed, because the customer insert had already
   * committed in its own transaction before a later step in that same approve() call threw). When
   * no manager is supplied (e.g. the standalone `POST /customers` route), this opens its own
   * transaction exactly as before — fully backward compatible.
   *
   * `companyDto` is optional — when supplied (only ever for a Corporate registration approval, see
   * RegistrationRequestService.toCreateCompanyDto), the linked Company row is created in the SAME
   * transaction right after the Customer row, so the two either both commit or both roll back
   * together. An Individual customer/registration never supplies this, and gets no Company row at
   * all — Customer 1:1 Company, row-absence models the optionality.
   */
  async create(dto: CreateCustomerDto, actorId?: number, manager?: EntityManager, companyDto?: CreateCompanyDto) {
    if (manager) return this.createWithManager(manager, dto, actorId, companyDto);
    return this.dataSource.transaction((txManager) => this.createWithManager(txManager, dto, actorId, companyDto));
  }

  private async createWithManager(
    manager: EntityManager,
    dto: CreateCustomerDto,
    actorId?: number,
    companyDto?: CreateCompanyDto,
  ) {
    const unit = await this.units.findOneEntity(dto.unitId);

    const existing = await manager.findOne(Customer, {
      where: { unit: { id: dto.unitId }, residentType: dto.residentType },
    });
    if (existing) {
      throw new ConflictException(
        `This unit already has a registered ${dto.residentType}`,
      );
    }

    const additionalUnits = dto.additionalUnitIds?.length
      ? await Promise.all(dto.additionalUnitIds.map((id) => this.units.findOneEntity(id)))
      : [];

    const { additionalUnitIds: _ignored, unitId: _unitIdIgnored, ...rest } = dto;

    const customer = manager.create(Customer, {
      ...rest,
      unit,
      additionalUnits,
      accountType: dto.accountType ?? CustomerAccountType.INDIVIDUAL,
      preferredCommunicationChannel: dto.preferredCommunicationChannel ?? 'Email',
      preferredLanguage: dto.preferredLanguage ?? 'English',
      accountStatus: dto.accountStatus ?? CustomerAccountStatus.ACTIVE,
    });
    const saved = await manager.save(Customer, customer);
    saved.businessCode = `CUS-${String(saved.id).padStart(6, '0')}`;
    await manager.save(Customer, saved);

    if (companyDto) {
      const company = manager.create(Company, { ...companyDto, customer: saved });
      await manager.save(Company, company);
    }

    await this.audit.record({
      moduleName: 'customers',
      entityId: saved.id,
      action: 'CREATE',
      newValue: {
        fullName: saved.fullName,
        residentType: saved.residentType,
        accountStatus: saved.accountStatus,
        unitId: saved.unit?.id,
      },
      performedBy: actorId,
    }, manager);

    return saved;
  }

  async findAll(query: CustomerQueryDto) {
    const { unitId, propertyId, communityId, residentType, accountStatus, search, sortBy, sortOrder } = query;

    const qb = this.customers
      .createQueryBuilder('c')
      .select(['c.id', 'c.businessCode', 'c.fullName', 'c.residentType', 'c.email', 'c.mobile', 'c.accountStatus', 'c.registeredDate', 'c.createdAt'])
      .leftJoin('c.unit', 'unit')
      .addSelect(['unit.id', 'unit.unitNumber'])
      .leftJoin('unit.property', 'property')
      .addSelect(['property.id', 'property.name'])
      .leftJoin('property.community', 'community')
      .addSelect(['community.id', 'community.name'])
      .orderBy(`c.${sortBy ?? 'createdAt'}`, sortOrder ?? 'DESC');

    if (search) {
      qb.andWhere(
        '(c.fullName LIKE :s OR c.businessCode LIKE :s OR c.email LIKE :s OR c.mobile LIKE :s OR unit.unitNumber LIKE :s)',
        { s: `%${search}%` },
      );
    }
    if (unitId) qb.andWhere('unit.id = :unitId', { unitId });
    if (propertyId) qb.andWhere('property.id = :propertyId', { propertyId });
    if (communityId) qb.andWhere('community.id = :communityId', { communityId });
    if (residentType) qb.andWhere('c.residentType = :residentType', { residentType });
    // Customer List represents actual approved/active accounts, not pending/pre-approval records —
    // defaults to Active-only when the caller doesn't ask for a specific status, so a Customer that
    // exists but hasn't completed activation yet (created INACTIVE at approval — see
    // RegistrationRequestService.toCreateCustomerDto()) never shows up in the normal list by
    // accident. An explicit accountStatus (the existing Active/Inactive/Overdue filter) still
    // overrides this and is honored exactly as given, so CS staff can still deliberately look up
    // Inactive/Overdue (e.g. to check on an approved-but-not-yet-activated customer).
    qb.andWhere('c.accountStatus = :accountStatus', { accountStatus: accountStatus ?? CustomerAccountStatus.ACTIVE });

    const result = await paginate(qb, query);
    const items: CustomerListDto[] = result.items.map((c: any) => ({
      id: c.id,
      businessCode: c.businessCode ?? null,
      fullName: c.fullName,
      residentType: c.residentType,
      email: c.email ?? null,
      mobile: c.mobile ?? null,
      accountStatus: c.accountStatus,
      registeredDate: c.registeredDate ?? null,
      unitId: c.unit?.id,
      unitNumber: c.unit?.unitNumber,
      propertyId: c.unit?.property?.id,
      propertyName: c.unit?.property?.name,
      communityId: c.unit?.property?.community?.id,
      communityName: c.unit?.property?.community?.name,
    }));
    return { items, pagination: result.pagination };
  }

  /** The Owner/Tenant summary for ONE unit — at most 2 rows (a unit has at most one Customer per
   *  residentType, enforced at creation). Exists so UnitService.findOne can compose this directly
   *  onto UnitDetailDto's own response (see that method) rather than the Communities feature's unit
   *  drill-through page calling GET /customers directly — that endpoint's VIEW_CUSTOMER permission
   *  is Customer module management (any filter, the full list), a materially bigger grant than "see
   *  the Owner/Tenant already displayed on the unit I'm looking at". Deliberately its own narrow
   *  shape (UnitCustomerSummaryDto) rather than reusing CustomerListDto — the unit/property/community
   *  fields on that DTO are redundant here (the caller already has them, being the unit itself).
   */
  async findByUnitId(unitId: number): Promise<UnitCustomerSummaryDto[]> {
    const rows = await this.customers
      .createQueryBuilder('c')
      .select(['c.id', 'c.businessCode', 'c.fullName', 'c.residentType', 'c.email', 'c.mobile', 'c.accountStatus'])
      .where('c.unit = :unitId', { unitId })
      .andWhere('c.accountStatus = :accountStatus', { accountStatus: CustomerAccountStatus.ACTIVE })
      .getMany();
    return rows.map((c) => ({
      id: c.id,
      businessCode: c.businessCode ?? null,
      fullName: c.fullName,
      residentType: c.residentType,
      email: c.email ?? null,
      mobile: c.mobile ?? null,
      accountStatus: c.accountStatus,
    }));
  }

  async findOne(id: number): Promise<CustomerDetailDto> {
    const customer = await this.customers.findOne({
      where: { id },
      relations: {
        unit: { property: { community: true }, subMeter: { masterMeter: true } },
        additionalUnits: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return {
      id: customer.id,
      businessCode: customer.businessCode ?? null,
      fullName: customer.fullName,
      residentType: customer.residentType,
      email: customer.email ?? null,
      mobile: customer.mobile ?? null,
      accountStatus: customer.accountStatus,
      securityDeposit: customer.securityDeposit != null ? Number(customer.securityDeposit) : null,
      registeredDate: customer.registeredDate ?? null,
      createdDate: customer.createdAt?.toISOString() ?? '',
      unitId: customer.unit.id,
      unitNumber: customer.unit.unitNumber,
      unitType: customer.unit.unitType ?? null,
      occupancyStatus: customer.unit.occupancyStatus,
      masterMeterId: customer.unit.subMeter?.masterMeter?.id ?? null,
      masterMeterCode: customer.unit.subMeter?.masterMeter?.businessCode ?? null,
      subMeterId: customer.unit.subMeter?.id ?? null,
      subMeterCode: customer.unit.subMeter?.businessCode ?? null,
      propertyId: customer.unit.property.id,
      propertyName: customer.unit.property.name,
      communityId: customer.unit.property.community.id,
      communityName: customer.unit.property.community.name,
      accountType: customer.accountType,
      isResident: customer.isResident ?? null,
      contactPersonName: customer.contactPersonName ?? null,
      photoUrl: customer.photoUrl ?? null,
      gender: customer.gender ?? null,
      dateOfBirth: customer.dateOfBirth ?? null,
      nationality: customer.nationality ?? null,
      preferredLanguage: customer.preferredLanguage,
      additionalUnitIds: (customer.additionalUnits ?? []).map((u) => u.id),
      paymentMethods: customer.paymentMethods ?? [],
      autoPayEnabled: customer.autoPayEnabled,
    };
  }

  /**
   * The Customer's own self-service profile edit (PATCH /me/profile) — deliberately narrower than
   * the staff-only `update()` above: only the fields UpdateMyProfileDto declares can ever be
   * touched here (fullName/email/mobile/dateOfBirth/gender/nationality/preferredLanguage), so a
   * Customer session can never reassign their own unit, flip their own accountStatus, or touch any
   * other staff-controlled field, no matter what a client sends — there is no field on this DTO to
   * carry that value in the first place. Returns via findOne() so the response is always the exact
   * same shape a GET would return, never a hand-assembled partial.
   */
  async updateMyProfile(customerId: number, dto: UpdateMyProfileDto): Promise<CustomerDetailDto> {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const oldValue = {
      fullName: customer.fullName,
      email: customer.email,
      mobile: customer.mobile,
      dateOfBirth: customer.dateOfBirth,
      gender: customer.gender,
      nationality: customer.nationality,
      preferredLanguage: customer.preferredLanguage,
    };

    Object.assign(customer, dto);
    await this.customers.save(customer);

    await this.audit.record({
      moduleName: 'customers',
      entityId: customerId,
      action: 'UPDATE',
      oldValue,
      newValue: dto,
      performedBy: customerId,
    });

    return this.findOne(customerId);
  }

  /**
   * The ONE reusable "which units does this Customer own" resolver — every customer-portal
   * endpoint that scopes a query to "my own resources" (units, properties, communities, meters,
   * documents, registration data) calls this rather than re-deriving Customer.unit/additionalUnits
   * itself, so there is exactly one place that answers "what does this customer own" instead of the
   * scattered ownership checks the feature's own requirements explicitly warn against. Returns the
   * primary unit id plus every additional unit id — a customer can genuinely own more than one unit
   * (see Customer.additionalUnits' own doc comment), so this is never just a single id.
   */
  async getOwnedUnitIds(customerId: number): Promise<number[]> {
    const customer = await this.customers.findOne({
      where: { id: customerId },
      relations: { unit: true, additionalUnits: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const ids = new Set<number>([customer.unit.id, ...(customer.additionalUnits ?? []).map((u) => u.id)]);
    return [...ids];
  }

  async findOneEntity(id: number): Promise<Customer> {
    const customer = await this.customers.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: number, dto: UpdateCustomerDto, actorId?: number) {
    const customer = await this.customers.findOne({
      where: { id },
      relations: { unit: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    if (dto.unitId && dto.unitId !== customer.unit?.id) {
      customer.unit = await this.units.findOneEntity(dto.unitId);
    }

    const oldValue = {
      fullName: customer.fullName,
      residentType: customer.residentType,
      accountStatus: customer.accountStatus,
    };

    const { additionalUnitIds, unitId: _ignored, ...rest } = dto;
    Object.assign(customer, rest);
    if (additionalUnitIds) {
      customer.additionalUnits = await Promise.all(
        additionalUnitIds.map((unitId) => this.units.findOneEntity(unitId)),
      );
    }
    const saved = await this.customers.save(customer);

    await this.audit.record({
      moduleName: 'customers',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: {
        fullName: saved.fullName,
        residentType: saved.residentType,
        accountStatus: saved.accountStatus,
      },
      performedBy: actorId,
    });

    return saved;
  }

  async remove(id: number, actorId?: number) {
    const customer = await this.customers.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');

    await this.customers.softRemove(customer);

    await this.audit.record({
      moduleName: 'customers',
      entityId: id,
      action: 'DELETE',
      oldValue: {
        fullName: customer.fullName,
        residentType: customer.residentType,
        accountStatus: customer.accountStatus,
      },
      performedBy: actorId,
    });

    return { deleted: true };
  }

  /**
   * The occupancy gate — spec §6.1 / §7.1 `GET /units/open-for-tenant`. For each unit id:
   *   - no registered Owner Customer on the unit  -> not open, OWNER_NOT_REGISTERED
   *   - a registered Owner with isResident=true    -> not open, owner occupies the unit
   *   - a registered Owner with isResident=false    -> open (lease-out owner)
   * Never guesses: a unit with no Owner customer at all is always closed, never assumed vacant.
   */
  async checkUnitsOpenForTenant(unitIds: number[]): Promise<Record<number, UnitOccupancyResolution>> {
    const result: Record<number, UnitOccupancyResolution> = {};
    if (!unitIds.length) return result;

    const owners = await this.customers.find({
      where: unitIds.map((unitId) => ({ unit: { id: unitId }, residentType: ResidentType.OWNER })),
      relations: { unit: true },
    });
    const ownerByUnit = new Map(owners.map((o) => [o.unit.id, o]));

    for (const unitId of unitIds) {
      const owner = ownerByUnit.get(unitId);
      if (!owner) {
        result[unitId] = {
          open: false,
          ownerName: null,
          ownerEmail: null,
          ownerPhone: null,
          reason: 'No owner registered',
        };
        continue;
      }
      if (owner.isResident === true) {
        result[unitId] = {
          open: false,
          ownerName: owner.fullName,
          ownerEmail: owner.email ?? null,
          ownerPhone: owner.mobile ?? null,
          reason: 'Owner occupies the unit',
        };
        continue;
      }
      result[unitId] = {
        open: true,
        ownerName: owner.fullName,
        ownerEmail: owner.email ?? null,
        ownerPhone: owner.mobile ?? null,
        reason: 'Lease-out owner — unit is available for tenancy',
      };
    }

    return result;
  }

  /**
   * Single source of truth for "does a customer of this same resident type already exist on
   * this unit" — the same conflict Customer.create() itself guards against
   * (unit + residentType uniqueness), surfaced here ahead of time so both registration
   * unit-selection (pre-approval) and approval can check it without duplicating the rule.
   * Deliberately does NOT check the opposite resident type — an existing Owner never conflicts
   * with a new Tenant and vice versa; that is allowed by design.
   */
  async checkUnitResidentTypeConflicts(
    unitIds: number[],
    residentType: ResidentType,
  ): Promise<Record<number, boolean>> {
    const result: Record<number, boolean> = {};
    if (!unitIds.length) return result;

    const existing = await this.customers.find({
      where: unitIds.map((unitId) => ({ unit: { id: unitId }, residentType })),
      relations: { unit: true },
    });
    const conflictedUnitIds = new Set(existing.map((c) => c.unit.id));

    for (const unitId of unitIds) {
      result[unitId] = conflictedUnitIds.has(unitId);
    }

    return result;
  }

  // ── Customer activation ─────────────────────────────────────────────────────────────────────────

  /**
   * Issues a fresh one-time activation token and emails the customer, choosing the template based
   * on whether a Security Deposit was actually raised (`depositAmount` present) or not. Called once,
   * right after RegistrationRequestService's post-approval deposit decision has committed — never
   * from inside that transaction (a listener, not a direct call from approve()/raiseDepositDemandIfRequired,
   * enforces this — see CustomerActivationListener), so a slow/failing SMTP send can never affect the
   * approval transaction itself. Also the method a manual "resend activation email" call re-runs —
   * each call issues a brand-new token (any previous unused one for this customer is invalidated by
   * setting its usedAt, since only one token should ever be redeemable at a time), so retrying never
   * creates a duplicate Customer or leaves multiple simultaneously-valid links outstanding.
   */
  async issueActivationEmail(customerId: number, depositAmount?: number): Promise<{ sent: boolean; error?: string }> {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (!customer.email) {
      this.logger.warn(`Cannot send activation email for customer ${customerId} — no email on file`);
      return { sent: false, error: 'Customer has no email address on file' };
    }

    await this.activationTokens.update(
      { customer: { id: customerId }, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    const rawToken = generateSecureToken();
    const expiryDuration = this.config.get<string>('ACTIVATION_TOKEN_EXPIRY', '48h');
    const expiresAt = parseExpiryDuration(expiryDuration);

    await this.activationTokens.save(
      this.activationTokens.create({
        tokenHash: hashSecureToken(rawToken),
        customer,
        expiresAt,
      }),
    );

    const portalBaseUrl = this.config.get<string>('CUSTOMER_PORTAL_URL', '').replace(/\/$/, '');
    const activationUrl = `${portalBaseUrl}/activate?token=${rawToken}`;
    const expiryLabel = formatExpiryLabel(expiryDuration);
    const customerReference = customer.businessCode ?? `Customer #${customer.id}`;

    const result =
      depositAmount != null
        ? await this.mail.sendTemplate(customer.email, securityDepositPaymentTemplate, {
            customerName: customer.fullName,
            customerReference,
            depositAmountLabel: `AED ${depositAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            activationUrl,
            expiryLabel,
          })
        : await this.mail.sendTemplate(customer.email, customerActivationTemplate, {
            customerName: customer.fullName,
            customerReference,
            activationUrl,
            expiryLabel,
          });

    await this.audit.record({
      moduleName: 'customers',
      entityId: customer.id,
      action: 'ACTIVATION_EMAIL_SENT',
      newValue: { sent: result.sent, depositRequired: depositAmount != null },
    });

    return result;
  }

  /** Manual re-trigger for CS/support use (e.g. the customer says they never received the email) —
   *  reuses issueActivationEmail exactly, so it can never create a duplicate Customer; it only ever
   *  issues a new token and invalidates the previous one. Deliberately does not accept a deposit
   *  amount from the caller — re-derives whether one applies from the request's live demand state,
   *  so a stale/guessed amount can never be sent. */
  async resendActivationEmail(customerId: number, actorId?: number): Promise<{ sent: boolean; error?: string }> {
    const customer = await this.customers.findOne({
      where: { id: customerId },
      relations: { unit: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.accountStatus === CustomerAccountStatus.ACTIVE) {
      throw new ConflictException('This customer has already activated their account');
    }

    const result = await this.issueActivationEmail(customerId, customer.securityDeposit != null ? Number(customer.securityDeposit) : undefined);

    await this.audit.record({
      moduleName: 'customers',
      entityId: customer.id,
      action: 'ACTIVATION_EMAIL_RESENT',
      newValue: { sent: result.sent },
      performedBy: actorId,
    });

    return result;
  }

  /**
   * Consumes a one-time activation token: validates it (exists, unexpired, unused), hashes and
   * stores the customer's own chosen password (same bcryptjs/12-rounds convention as staff Users —
   * never a staff-set or default password), and marks the token used so it can never be replayed.
   *
   * `accountStatus` does NOT unconditionally flip to ACTIVE here anymore — setting a password is
   * "account setup", not "account fully active". Whether a Security Deposit is required is checked
   * live (via RegistrationRequestService.getMyDepositStatus, the SAME resolver CustomerAccessGuard
   * uses) and:
   *   - deposit resolved already (Not Required, or — legacy edge case — already Verified before
   *     activation happened) → flips to ACTIVE immediately, same as before for this one case.
   *   - deposit still pending (Requested / Paid - Pending Verification / no request on file at all)
   *     → stays INACTIVE. The customer CAN still log in from here on — see AuthService.login/refresh,
   *     which now allow a password-set-but-INACTIVE Customer through (accountStatus alone no longer
   *     gates login; only "no password set at all" does) — it's `portalAccess` (CustomerAccessGuard /
   *     bootstrap) that then restricts what a logged-in-but-not-yet-fully-active session can reach.
   *     `accountStatus` only reaches ACTIVE once RegistrationRequestService.verifyDeposit() sets it
   *     — the one other place this column is written — mirroring exactly how a Not Required
   *     decision skips the deposit sub-process entirely without inventing a fake payment step.
   */
  async activate(dto: ActivateCustomerDto): Promise<{ customerId: number }> {
    const tokenHash = hashSecureToken(dto.token);
    const token = await this.activationTokens.findOne({
      where: { tokenHash },
      relations: { customer: true },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      this.logger.warn('Activation attempted with an invalid, already-used, or expired token');
      throw new BadRequestException('This activation link is invalid or has expired');
    }

    const { depositStatus } = await this.registrationRequests.getMyDepositStatus(token.customer.id);
    const shouldActivateNow = isDepositResolved(depositStatus);

    return this.dataSource.transaction(async (manager) => {
      const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);
      const updateResult = await manager.update(Customer, token.customer.id, {
        passwordHash,
        ...(shouldActivateNow ? { accountStatus: CustomerAccountStatus.ACTIVE } : {}),
      });
      // affected should always be 1 here (token.customer.id came from a real, just-loaded relation)
      // — logged as a hard error rather than silently trusting the update, since a 0-row update
      // would otherwise look identical to a successful activation from this method's own return
      // value alone (a customer could complete activation, see success, and still be unable to log
      // in afterward with no visible signal of why).
      if (updateResult.affected !== 1) {
        this.logger.error(`Activation password update affected ${updateResult.affected} rows for customer ${token.customer.id} — expected exactly 1`);
        throw new Error('Failed to persist the new password — please try again or contact support');
      }

      token.usedAt = new Date();
      await manager.save(CustomerActivationToken, token);

      await this.audit.record({
        moduleName: 'customers',
        entityId: token.customer.id,
        action: 'ACTIVATED',
        newValue: { accountStatus: shouldActivateNow ? CustomerAccountStatus.ACTIVE : CustomerAccountStatus.INACTIVE },
      }, manager);

      this.logger.log(
        `Customer ${token.customer.id} completed account setup — ` +
          (shouldActivateNow
            ? 'deposit already resolved, account is now active'
            : `account stays inactive pending Security Deposit (depositStatus="${depositStatus}")`),
      );
      return { customerId: token.customer.id };
    });
  }

  /**
   * The OTHER place `accountStatus` moves off INACTIVE — called by RegistrationRequestService.
   * verifyDeposit() once a required Security Deposit is actually verified (activate() only handles
   * the "Not Required" case immediately; a required deposit's account stays INACTIVE through
   * password-set/payment and only reaches ACTIVE here). Idempotent by construction (a no-op
   * `UPDATE ... SET account_status = 'active'` on an already-ACTIVE row is harmless) rather than
   * checking current status first — verifyDeposit() already guards its own call site so this is
   * only ever reached once per request in practice, but there is no reason to make this method
   * itself fragile to being called twice. `manager` is REQUIRED (not optional like create()'s) —
   * this must always run inside verifyDeposit()'s own transaction so "deposit verified" and
   * "account activated" can never commit as two separate, potentially-inconsistent writes.
   */
  async activateFromDepositVerification(customerId: number, manager: EntityManager): Promise<void> {
    await manager.update(Customer, customerId, { accountStatus: CustomerAccountStatus.ACTIVE });
    this.logger.log(`Customer ${customerId} activated — required Security Deposit verified`);
  }

  /**
   * The one query customer login (AuthService.login) uses to authenticate a Customer — separate
   * from findOne/findAll (which never select passwordHash, per that column's own `select: false`)
   * so this hidden-by-default column is only ever read from this one, narrowly-scoped path. Mirrors
   * UserService.findByEmailWithRole's exact shape (addSelect the hidden hash, single row by email)
   * so both login paths follow the same, already-reviewed pattern.
   */
  findByEmailForLogin(email: string): Promise<Customer | null> {
    return this.customers
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.email = :email', { email })
      .getOne();
  }

  /**
   * Same narrowly-scoped shape as findByEmailForLogin (addSelect the hidden passwordHash column),
   * keyed by id instead of email — for AuthService.changePassword, which already has the
   * authenticated principal's id (from the JWT `sub`) and has no reason to look them up by email.
   */
  findByIdWithPasswordHash(id: number): Promise<Customer | null> {
    return this.customers
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :id', { id })
      .getOne();
  }

  async setPasswordHash(customerId: number, passwordHash: string): Promise<void> {
    await this.customers.update(customerId, { passwordHash });
  }
}

function formatExpiryLabel(expiryDuration: string): string {
  const match = expiryDuration.match(/^(\d+)([smhd])$/);
  if (!match) return `in ${expiryDuration}`;
  const value = Number(match[1]);
  const unit: Record<string, string> = { s: 'second', m: 'minute', h: 'hour', d: 'day' };
  const label = unit[match[2]] ?? match[2];
  return `in ${value} ${label}${value === 1 ? '' : 's'}`;
}

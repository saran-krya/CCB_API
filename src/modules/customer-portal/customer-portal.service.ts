import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerService } from '../customer/customer.service';
import { CommunityService } from '../community/community.service';
import { PropertyService } from '../property/property.service';
import { UnitService } from '../unit/unit.service';
import { MeterService } from '../meter/meter.service';
import { RegistrationRequestService } from '../registration-request/registration-request.service';
import { LovService } from '../lov/lov.service';
import { AttributeService } from '../attribute/attribute.service';
import { DailyMeterReadingQueryDto } from '../meter/dto/meter.dto';
import { RecordDepositPaymentDto } from '../registration-request/dto/registration-request.dto';
import { UpdateMyProfileDto } from '../customer/dto/update-my-profile.dto';
import { MyRegistrationConfigDto, MyRegistrationConfigLovValueDto } from './dto/my-registration-config.dto';

/**
 * Composes the SAME services staff controllers already use (CommunityService/PropertyService/
 * UnitService/MeterService/RegistrationRequestService/CustomerService/LovService/AttributeService)
 * — no duplicated query logic, no second copy of any entity's read path. The ONLY thing this
 * service adds is ownership/exposure scoping: every method here first resolves the authenticated
 * customer's own unit ids (via CustomerService.getOwnedUnitIds, the ONE reusable resolver — see its
 * own doc comment) and either filters by them or throws ForbiddenException if a requested id falls
 * outside that set — OR, for getMyRegistrationConfig, composes only the specific LOV categories/
 * attribute keys the customer wizard actually renders, rather than exposing the generic staff-only
 * /lov and /attributes endpoints to a Customer session at all. This is where "prevent a Customer
 * from accessing another Customer's data, or data outside its intended scope" actually lives — one
 * place, not scattered per-controller checks.
 */
@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly customers: CustomerService,
    private readonly communities: CommunityService,
    private readonly properties: PropertyService,
    private readonly units: UnitService,
    private readonly meters: MeterService,
    private readonly registrationRequests: RegistrationRequestService,
    private readonly lov: LovService,
    private readonly attributes: AttributeService,
  ) {}

  async getMyProfile(customerId: number) {
    return this.customers.findOne(customerId);
  }

  async updateMyProfile(customerId: number, dto: UpdateMyProfileDto) {
    return this.customers.updateMyProfile(customerId, dto);
  }

  async getMyUnits(customerId: number) {
    const unitIds = await this.customers.getOwnedUnitIds(customerId);
    return Promise.all(unitIds.map((id) => this.units.findOne(id)));
  }

  async getMyUnit(customerId: number, unitId: number) {
    await this.assertOwnsUnit(customerId, unitId);
    return this.units.findOne(unitId);
  }

  /** Meter details for every unit the Customer owns (primary + additional — same ownership
   *  resolver every other method here uses) — never a client-supplied unit id, so there is nothing
   *  to authorize against beyond "is this one of my own units", already guaranteed by resolving the
   *  id list server-side first. */
  async getMyMeters(customerId: number) {
    const unitIds = await this.customers.getOwnedUnitIds(customerId);
    return Promise.all(unitIds.map((id) => this.units.findMeterDetail(id)));
  }

  async getMyProperties(customerId: number) {
    const units = await this.getMyUnits(customerId);
    const propertyIds = [...new Set(units.map((u) => u.propertyId))];
    const properties = await Promise.all(propertyIds.map((id) => this.properties.findOne(id)));
    return properties.map((p) => this.scopePropertyUnitsToOwn(p, units));
  }

  async getMyProperty(customerId: number, propertyId: number) {
    const units = await this.getMyUnits(customerId);
    if (!units.some((u) => u.propertyId === propertyId)) {
      throw new ForbiddenException('This property is not associated with your account');
    }
    const property = await this.properties.findOne(propertyId);
    return this.scopePropertyUnitsToOwn(property, units);
  }

  async getMyCommunities(customerId: number) {
    const units = await this.getMyUnits(customerId);
    const communityIds = [...new Set(units.map((u) => u.communityId))];
    const communities = await Promise.all(communityIds.map((id) => this.communities.findOne(id)));
    return communities.map((c) => this.scopeCommunityPropertiesToOwn(c, units));
  }

  async getMyCommunity(customerId: number, communityId: number) {
    const units = await this.getMyUnits(customerId);
    if (!units.some((u) => u.communityId === communityId)) {
      throw new ForbiddenException('This community is not associated with your account');
    }
    const community = await this.communities.findOne(communityId);
    return this.scopeCommunityPropertiesToOwn(community, units);
  }

  /** `query.unitId`, if given, must be one of the caller's own units — never trusted blindly. When
   *  omitted, returns readings across ALL of the caller's own units (never every unit in the
   *  system), one query per owned unit — mirrors how a customer with multiple units expects to see
   *  all of them, per the feature's own "if the customer has access to multiple units, return all
   *  resources that genuinely belong to them" requirement. */
  async getMyMeterReadings(customerId: number, query: DailyMeterReadingQueryDto) {
    const unitIds = await this.customers.getOwnedUnitIds(customerId);

    if (query.unitId != null) {
      if (!unitIds.includes(query.unitId)) {
        throw new ForbiddenException('This unit is not associated with your account');
      }
      return this.meters.getDailyMeterReadings(query);
    }

    const perUnit = await Promise.all(
      unitIds.map((unitId) => this.meters.getDailyMeterReadings({ ...query, unitId })),
    );
    const items: Array<(typeof perUnit)[number]['items'][number]> = [];
    for (const r of perUnit) items.push(...r.items);
    return {
      items,
      pagination: perUnit[0]?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 },
    };
  }

  /** meterId is a business-code string, not a numeric FK (see MeterService.getMeterReadingHistory)
   *  — ownership is checked by confirming it matches one of the caller's own units' resolved
   *  master/sub meter codes (already composed onto UnitDetailDto by UnitService.findOne), since
   *  there is no direct meter->customer relation to query instead. */
  async getMyMeterReadingHistory(customerId: number, meterId: string, upToDate?: string) {
    const units = await this.getMyUnits(customerId);
    const ownedMeterCodes = new Set(
      units.flatMap((u) => [u.masterMeterCode, u.subMeterCode].filter((c): c is string => !!c)),
    );
    if (!ownedMeterCodes.has(meterId)) {
      throw new ForbiddenException('This meter is not associated with your account');
    }
    return this.meters.getMeterReadingHistory(meterId, upToDate);
  }

  /** The one-time registration-approval deposit (see RegistrationDeposit's own doc comment — there
   *  is no separate ongoing/recurring deposit concept) — read from the customer's own approved
   *  registration request, the same `?customerId=` query path the staff Customer Detail page
   *  already uses (see RegistrationRequestController's own doc comment on that route).
   *
   *  `activeDemand` is resolved through RegistrationRequestService.resolveActiveDemand — the SAME
   *  function `recordDepositPayment` uses to pick which demand a new payment targets. Returning the
   *  full `demands` history array is still useful for display (e.g. a reversed demand's old payment
   *  reference), but the frontend must never guess "the" active one from that array's shape (last
   *  item, first item, most recent) — a `Reversed` demand created before a re-raise can otherwise
   *  outrank the real new `Raised` one depending on array order, which is exactly the bug class this
   *  field exists to close off. `null` here means no demand is currently payable (deposit not yet
   *  requested, already paid, or already verified) — the frontend's Pay action must gate on this,
   *  not on `demands.length`. */
  async getMySecurityDeposit(customerId: number) {
    const request = await this.getMyOriginRequest(customerId);
    if (!request) {
      throw new NotFoundException('No registration request found for your account');
    }
    return {
      depositStatus: request.depositStatus,
      activeDemand: this.registrationRequests.resolveActiveDemand(request) ?? null,
      demands: request.demands,
    };
  }

  /**
   * The Customer-facing counterpart to the staff-only POST .../record-deposit-payment — same
   * backend transition (RegistrationRequestService.recordDepositPayment: Requested -> Paid -
   * Pending Verification), reused as-is rather than duplicated, with the request id resolved from
   * the CALLER'S OWN registration request, never trusted from a client-supplied id — there is no
   * `:id` in this route for exactly that reason (see CustomerPortalController's own doc comment on
   * `/me/*`'s id-less shape). This never sets depositStatus to Verified — that transition only
   * exists on RegistrationRequestService.verifyDeposit, which stays staff-only
   * (REGISTRATION_APPROVAL_APPROVE), never exposed here or anywhere a Customer session can reach.
   * `paymentMethod`/`paymentReference` are the same provider-agnostic fields the staff flow already
   * uses — a real payment gateway integration later would populate these with its own transaction
   * reference instead of a customer-typed one, without this method's shape needing to change at all.
   */
  async payMySecurityDeposit(customerId: number, dto: RecordDepositPaymentDto) {
    const request = await this.getMyOriginRequest(customerId);
    if (!request) {
      throw new NotFoundException('No registration request found for your account');
    }
    return this.registrationRequests.recordDepositPayment(request.id, dto, undefined, true);
  }

  async getMyRegistrationRequests(customerId: number) {
    const result = await this.registrationRequests.findAll({ customerId, page: 1, limit: 50 });
    return result.items;
  }

  async getMyRegistrationRequest(customerId: number, requestId: number) {
    const request = await this.registrationRequests.findOne(requestId);
    if (!request.customer || request.customer.id !== customerId) {
      throw new ForbiddenException('This registration request is not associated with your account');
    }
    return request;
  }

  /** Documents live on RegistrationRequest, not on Customer directly (see
   *  RegistrationDocument's own relation) — a customer's own documents are whatever is attached to
   *  their one originating (approved) request. */
  async getMyDocuments(customerId: number) {
    const request = await this.getMyOriginRequest(customerId);
    return request?.documents ?? [];
  }

  /**
   * The Customer Registration Wizard's substitute for calling GET /lov and GET /attributes
   * directly (staff-only endpoints a Customer session has no permission for, and never should —
   * granting that permission would expose every OTHER LOV category/attribute in the system, not
   * just the handful the wizard's identity/company/payment steps actually render). Every value
   * below comes straight from LovService.findByCategory / AttributeService.getValueByKey — the
   * EXACT SAME service methods the staff /lov and /attributes controllers call — so there is still
   * exactly one source of truth for both LOV values and mandatory-field configuration; this method
   * only decides WHICH categories/keys a Customer session may read, never re-derives or hardcodes
   * any of their actual values. Requires no customerId-based scoping (unlike every other method in
   * this service) since none of this configuration is customer-specific — every customer sees the
   * same wizard field configuration, same as every staff user does.
   */
  async getMyRegistrationConfig(): Promise<MyRegistrationConfigDto> {
    const lovValues = (category: string) =>
      this.lov.findByCategory(category).then(
        (values): MyRegistrationConfigLovValueDto[] => values.map((v) => ({ code: v.code, label: v.label })),
      );
    const mandatory = (key: string) => this.attributes.getValueByKey(key).then((value) => value === 'true');

    const [
      salutationOptions,
      genderOptions,
      nationalityOptions,
      maritalStatusOptions,
      communicationChannelOptions,
      languageOptions,
      relationshipOptions,
      legalStructureOptions,
      paymentMethodTypeOptions,
      nameMandatory,
      emailMandatory,
      mobileMandatory,
      emergencyContactMandatory,
      principalMandatory,
      tradeLicenseNumberMandatory,
      managerNameMandatory,
      taxableEntityNameMandatory,
      trnMandatory,
      effectiveRegistrationDateMandatory,
      issuingAuthorityMandatory,
      paymentMethodMandatory,
      registrationFaqEnabled,
    ] = await Promise.all([
      lovValues('SALUTATION'),
      lovValues('GENDER'),
      lovValues('NATIONALITY'),
      lovValues('MARITAL_STATUS'),
      lovValues('COMMUNICATION_CHANNEL'),
      lovValues('LANGUAGE'),
      lovValues('RELATIONSHIP'),
      lovValues('LEGAL_STRUCTURE'),
      lovValues('PAYMENT_METHOD_TYPE'),
      mandatory('REGISTRATION_NAME_MANDATORY'),
      mandatory('REGISTRATION_EMAIL_MANDATORY'),
      mandatory('REGISTRATION_MOBILE_MANDATORY'),
      mandatory('REGISTRATION_EMERGENCY_CONTACT_MANDATORY'),
      mandatory('REGISTRATION_PRINCIPAL_MANDATORY'),
      mandatory('REGISTRATION_TRADE_LICENSE_NUMBER_MANDATORY'),
      mandatory('REGISTRATION_MANAGER_NAME_MANDATORY'),
      mandatory('REGISTRATION_TAXABLE_ENTITY_NAME_MANDATORY'),
      mandatory('REGISTRATION_TRN_MANDATORY'),
      mandatory('REGISTRATION_EFFECTIVE_REGISTRATION_DATE_MANDATORY'),
      mandatory('REGISTRATION_ISSUING_AUTHORITY_MANDATORY'),
      mandatory('REGISTRATION_PAYMENT_METHOD_MANDATORY'),
      // Admin-configurable business behavior, NOT plain field data — resolved via
      // getCustomerValueByKey (falls back to the global `value` when Admin hasn't configured a
      // Customer-specific override), never getValueByKey (the Staff/User-only read).
      this.attributes.getCustomerValueByKey('REGISTRATION_FAQ_ENABLED').then((value) => value === 'true'),
    ]);

    return {
      salutationOptions,
      genderOptions,
      nationalityOptions,
      maritalStatusOptions,
      communicationChannelOptions,
      languageOptions,
      relationshipOptions,
      legalStructureOptions,
      paymentMethodTypeOptions,
      nameMandatory,
      emailMandatory,
      mobileMandatory,
      emergencyContactMandatory,
      principalMandatory,
      tradeLicenseNumberMandatory,
      managerNameMandatory,
      taxableEntityNameMandatory,
      trnMandatory,
      effectiveRegistrationDateMandatory,
      issuingAuthorityMandatory,
      paymentMethodMandatory,
      features: { registrationFaqEnabled },
    };
  }

  private async assertOwnsUnit(customerId: number, unitId: number): Promise<void> {
    const unitIds = await this.customers.getOwnedUnitIds(customerId);
    if (!unitIds.includes(unitId)) {
      throw new ForbiddenException('This unit is not associated with your account');
    }
  }

  private async getMyOriginRequest(customerId: number) {
    const result = await this.registrationRequests.findAll({ customerId, page: 1, limit: 1 });
    const originId = result.items[0]?.id;
    if (!originId) return null;
    return this.registrationRequests.findOne(originId);
  }

  /** PropertyService.findOne is a staff-facing "manage this whole property" view — its own
   *  `units[]` genuinely lists EVERY unit in the property, by design, for a property manager.
   *  Reused as-is for a Customer response, that would leak every other resident's unit
   *  number/floor/bedroom count — data that belongs to unrelated customers. Rather than forking
   *  PropertyService's query (which would duplicate its logic and drift over time), this strips
   *  the nested list down to the caller's own units after the fact, right at the customer-portal
   *  boundary where ownership scoping already lives. The top-level aggregate stats
   *  (totalUnits/occupiedUnits/etc.) are left as-is — those describe the property itself
   *  (structural/public-ish info, like a building's floor count), not any individual resident's
   *  data, so they are not a privacy concern the way a per-unit listing is. */
  private scopePropertyUnitsToOwn<T extends { units: Array<{ id: number }> }>(
    property: T,
    ownedUnits: Array<{ id: number }>,
  ): T {
    const ownedIds = new Set(ownedUnits.map((u) => u.id));
    return { ...property, units: property.units.filter((u) => ownedIds.has(u.id)) };
  }

  /** Same reasoning as scopePropertyUnitsToOwn — CommunityService.findOne's `properties[]` lists
   *  every property in the community for a staff manager; here it's stripped to only the
   *  property(ies) the caller actually has a unit in. */
  private scopeCommunityPropertiesToOwn<T extends { properties: Array<{ id: number }> }>(
    community: T,
    ownedUnits: Array<{ propertyId: number }>,
  ): T {
    const ownedPropertyIds = new Set(ownedUnits.map((u) => u.propertyId));
    return { ...community, properties: community.properties.filter((p) => ownedPropertyIds.has(p.id)) };
  }
}

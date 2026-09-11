import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerAccessible } from '../../common/decorators/customer-accessible.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { AuthenticatedCustomer } from '../../auth/interfaces/authenticated-user.interface';
import { DailyMeterReadingQueryDto } from '../meter/dto/meter.dto';
import { RecordDepositPaymentDto } from '../registration-request/dto/registration-request.dto';
import { UpdateMyProfileDto } from '../customer/dto/update-my-profile.dto';
import { MyRegistrationConfigDto } from './dto/my-registration-config.dto';
import { CustomerPortalService } from './customer-portal.service';

/**
 * The Customer Portal's own controller — every route here is `@CustomerAccessible()` (never
 * `@Permission(...)`; a Customer has no Role/Action tree to check against — see
 * CustomerAccessGuard's own doc comment) and every id in every response is resolved from the
 * authenticated Customer's own data (CustomerPortalService's ownership checks), never from a
 * client-supplied customerId. `/me/*` naming (not `/customers/:id/...`) makes that explicit at the
 * route level: there is no id to substitute in the URL for "my own" endpoints, and the few that do
 * take a resource id (unit/property/community/registration-request) verify ownership before
 * returning anything.
 *
 * TWO tiers of `@CustomerAccessible()` now exist (see that decorator's own doc comment on
 * `allowRestricted`): `{ allowRestricted: true }` on profile/security-deposit(GET+POST)/
 * registration-requests/documents — the handful of routes a Customer still mid-registration
 * (password set, deposit not yet resolved) needs to see their own status and pay their deposit — and
 * the plain (restricted-by-default) `@CustomerAccessible()` on units/properties/communities/
 * meter-readings, which stay off-limits until CustomerAccessGuard's live depositStatus check
 * resolves. This is the actual enforcement of "pre-active Customer gets only the registration
 * completion flow" — never a frontend-only restriction.
 *
 * Kept as its own controller/module rather than adding `@CustomerAccessible()` routes onto the
 * existing staff CommunityController/PropertyController/UnitController/etc. — those controllers'
 * whole existing shape (list/create/update/delete, `@Permission`-gated) is staff CRUD; mixing a
 * customer's narrow, ownership-scoped read routes into them would blur which controller owns which
 * authorization model. This controller composes CustomerPortalService, which itself composes the
 * SAME staff services (CommunityService/PropertyService/UnitService/MeterService/
 * RegistrationRequestService) — no duplicated query logic anywhere.
 */
@ApiBearerAuth()
@ApiTags('Customer Portal')
@Controller({ path: 'me', version: '1' })
export class CustomerPortalController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Get('profile')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({ summary: "The authenticated Customer's own profile" })
  getMyProfile(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyProfile(customer.sub);
  }

  @Patch('profile')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({
    summary:
      "Update the authenticated Customer's own editable profile fields (fullName/email/mobile/" +
      'dateOfBirth/gender/nationality/preferredLanguage only — every other field on the profile ' +
      'response is staff-controlled or derived from the unit relationship, never editable here)',
  })
  updateMyProfile(@Body() dto: UpdateMyProfileDto, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.updateMyProfile(customer.sub, dto);
  }

  @Get('units')
  @CustomerAccessible()
  @ApiOperation({ summary: 'All units genuinely owned by the authenticated Customer (primary + additional)' })
  getMyUnits(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyUnits(customer.sub);
  }

  @Get('units/:id')
  @CustomerAccessible()
  @ApiOperation({ summary: 'One of the authenticated Customer\'s own units' })
  getMyUnit(@Param('id', ParseIntPipe) id: number, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyUnit(customer.sub, id);
  }

  @Get('properties')
  @CustomerAccessible()
  @ApiOperation({ summary: 'Every property the authenticated Customer has a unit in' })
  getMyProperties(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyProperties(customer.sub);
  }

  @Get('properties/:id')
  @CustomerAccessible()
  @ApiOperation({ summary: 'One property the authenticated Customer has a unit in' })
  getMyProperty(@Param('id', ParseIntPipe) id: number, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyProperty(customer.sub, id);
  }

  @Get('communities')
  @CustomerAccessible()
  @ApiOperation({ summary: 'Every community the authenticated Customer has a unit in' })
  getMyCommunities(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyCommunities(customer.sub);
  }

  @Get('communities/:id')
  @CustomerAccessible()
  @ApiOperation({ summary: 'One community the authenticated Customer has a unit in' })
  getMyCommunity(@Param('id', ParseIntPipe) id: number, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyCommunity(customer.sub, id);
  }

  @Get('meters')
  @CustomerAccessible()
  @ApiOperation({ summary: "Meter details (sub meter + its master meter) for the authenticated Customer's own unit(s)" })
  getMyMeters(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyMeters(customer.sub);
  }

  @Get('meter-readings')
  @CustomerAccessible()
  @ApiOperation({ summary: "Daily meter readings for the authenticated Customer's own unit(s)" })
  getMyMeterReadings(
    @Query() query: DailyMeterReadingQueryDto,
    @CurrentCustomer() customer: AuthenticatedCustomer,
  ) {
    return this.portal.getMyMeterReadings(customer.sub, query);
  }

  @Get('meter-readings/history/:meterId')
  @CustomerAccessible()
  @ApiOperation({ summary: "Reading history for one of the authenticated Customer's own meters" })
  getMyMeterReadingHistory(
    @Param('meterId') meterId: string,
    @Query('date') date: string | undefined,
    @CurrentCustomer() customer: AuthenticatedCustomer,
  ) {
    return this.portal.getMyMeterReadingHistory(customer.sub, meterId, date);
  }

  @Get('security-deposit')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({ summary: "The authenticated Customer's own security deposit status" })
  getMySecurityDeposit(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMySecurityDeposit(customer.sub);
  }

  @Post('security-deposit/pay')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({
    summary:
      "Record the authenticated Customer's own security deposit payment — the same backend " +
      'transition the staff record-deposit-payment action uses (Requested -> Paid - Pending ' +
      'Verification). Never sets Verified; that stays a staff-only action.',
  })
  payMySecurityDeposit(
    @Body() dto: RecordDepositPaymentDto,
    @CurrentCustomer() customer: AuthenticatedCustomer,
  ) {
    return this.portal.payMySecurityDeposit(customer.sub, dto);
  }

  @Get('registration-requests')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({ summary: "The authenticated Customer's own registration request history" })
  getMyRegistrationRequests(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyRegistrationRequests(customer.sub);
  }

  @Get('registration-requests/:id')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({ summary: "One of the authenticated Customer's own registration requests, in full detail" })
  getMyRegistrationRequest(
    @Param('id', ParseIntPipe) id: number,
    @CurrentCustomer() customer: AuthenticatedCustomer,
  ) {
    return this.portal.getMyRegistrationRequest(customer.sub, id);
  }

  @Get('registration-config')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({
    summary:
      'LOV values + mandatory-field configuration the Customer Registration Wizard needs to render ' +
      'its identity/company/payment steps — the customer-safe substitute for calling the staff-only ' +
      'GET /lov and GET /attributes directly (same underlying LovService/AttributeService, scoped to ' +
      'only the categories/keys this wizard actually uses)',
  })
  @ApiOkResponse({ type: MyRegistrationConfigDto })
  getMyRegistrationConfig(): Promise<MyRegistrationConfigDto> {
    return this.portal.getMyRegistrationConfig();
  }

  @Get('documents')
  @CustomerAccessible({ allowRestricted: true })
  @ApiOperation({ summary: "Documents attached to the authenticated Customer's own registration request" })
  getMyDocuments(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.portal.getMyDocuments(customer.sub);
  }
}

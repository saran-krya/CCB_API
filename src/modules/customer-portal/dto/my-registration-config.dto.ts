import { ApiProperty } from '@nestjs/swagger';

export class MyRegistrationConfigLovValueDto {
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
}

/** Admin-configurable business behavior — genuinely distinct from the LOV/mandatory-field DATA
 *  above, which is why it gets its own nested section rather than sitting flat alongside them (see
 *  the registration-flow audit's Category A/Common-Data vs Category B/Admin-Config distinction).
 *  Only REGISTRATION_FAQ_ENABLED lives here today — the one attribute with a genuine Staff/User vs
 *  Customer business need; nothing else is added speculatively. Resolved via
 *  AttributeService.getCustomerValueByKey (falls back to the global `value` when no Customer-
 *  specific override is configured), never the staff-only getValueByKey. */
export class MyRegistrationConfigFeaturesDto {
  @ApiProperty() registrationFaqEnabled!: boolean;
}

/**
 * The ONE customer-safe substitute for the staff-only GET /lov + GET /attributes the Customer
 * Registration Wizard used to call directly (and 403 on, since a Customer session has no
 * permission to those generic staff endpoints — see CustomerPortalService.getMyRegistrationConfig's
 * own doc comment for why granting that permission is explicitly the WRONG fix). Every field here
 * is read straight from LovService.findByCategory / AttributeService.getValueByKey — the exact same
 * service methods the staff endpoints call — composed into one response scoped to only what the
 * customer-facing steps of the wizard (identity/company, payment) actually render. No new LOV
 * categories or attribute keys exist anywhere else — this is exposure-scoping, not new
 * configuration, and both stay editable by staff through the existing LOV/Attribute admin screens.
 */
export class MyRegistrationConfigDto {
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) salutationOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) genderOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) nationalityOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) maritalStatusOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) communicationChannelOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) languageOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) relationshipOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) legalStructureOptions!: MyRegistrationConfigLovValueDto[];
  @ApiProperty({ type: () => [MyRegistrationConfigLovValueDto] }) paymentMethodTypeOptions!: MyRegistrationConfigLovValueDto[];

  @ApiProperty() nameMandatory!: boolean;
  @ApiProperty() emailMandatory!: boolean;
  @ApiProperty() mobileMandatory!: boolean;
  @ApiProperty() emergencyContactMandatory!: boolean;
  @ApiProperty() principalMandatory!: boolean;
  @ApiProperty() tradeLicenseNumberMandatory!: boolean;
  @ApiProperty() managerNameMandatory!: boolean;
  @ApiProperty() taxableEntityNameMandatory!: boolean;
  @ApiProperty() trnMandatory!: boolean;
  @ApiProperty() effectiveRegistrationDateMandatory!: boolean;
  @ApiProperty() issuingAuthorityMandatory!: boolean;
  @ApiProperty() paymentMethodMandatory!: boolean;

  @ApiProperty({ type: () => MyRegistrationConfigFeaturesDto }) features!: MyRegistrationConfigFeaturesDto;
}

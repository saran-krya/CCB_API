import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import {
  RegistrationAccountType,
  RegistrationChannel,
  RegistrationContactType,
  RegistrationLegalStructure,
  RegistrationRequestStatus,
  RegistrationResidentType,
  RegistrationUnitType,
} from '../entities/registration-request.entity';

export class SelectedUnitDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitId!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  propertyId!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  communityId!: number;
}

export class PropertyBillingDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  propertyId!: number;

  /** LOV-driven (category BILLING_TYPE) — a configurable business value, not a fixed enum. */
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  billingType!: string;
}

export class PaymentMethodDto {
  // Optional, and unread by the persistence layer even when sent — syncChildCollections()
  // always fully deletes and recreates this request's whole payment-methods collection on every
  // save (never matches an incoming row to an existing one by id), so a client-supplied id has no
  // effect on persistence. Kept optional rather than removed outright so an older client that
  // still sends its local id (e.g. `pm-<timestamp>`) doesn't fail validation on this field alone.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  type!: string;

  @ApiProperty()
  @IsString()
  maskedIdentifier!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() brandOrBank?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() expiry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountHolderName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;

  @ApiProperty()
  @IsBoolean()
  isDefault!: boolean;
}

/**
 * Draft creation input (Path B / CS-initiated) — spec §7.2 `POST /registration-requests/draft`.
 * Every field the applicant record eventually carries is optional here: a Draft is deliberately
 * allowed to be sparse and filled in over multiple saves before it is ever submitted.
 */
export class CreateRegistrationRequestDraftDto {
  @ApiPropertyOptional({ enum: RegistrationChannel, default: RegistrationChannel.CS })
  @IsOptional()
  @IsEnum(RegistrationChannel)
  channel?: RegistrationChannel;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) salutation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) middleName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) occupation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) alternatePhone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) principalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() principalEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) principalPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() principalIsPrimaryRecipient?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) propertyDocumentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) propertyDocumentReference?: string;

  @ApiProperty({ enum: RegistrationAccountType })
  @IsEnum(RegistrationAccountType)
  accountType!: RegistrationAccountType;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) contactPersonName?: string;
  @ApiPropertyOptional({ enum: RegistrationContactType })
  @IsOptional()
  @IsEnum(RegistrationContactType)
  contactType?: RegistrationContactType;

  @ApiProperty({ enum: RegistrationResidentType })
  @IsEnum(RegistrationResidentType)
  residentType!: RegistrationResidentType;

  @ApiPropertyOptional({ enum: RegistrationUnitType })
  @IsOptional()
  @IsEnum(RegistrationUnitType)
  unitType?: RegistrationUnitType;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isResident?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) nationality?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) maritalStatus?: string;

  @ApiPropertyOptional({ enum: RegistrationLegalStructure })
  @IsOptional()
  @IsEnum(RegistrationLegalStructure)
  legalStructure?: RegistrationLegalStructure;
  @ApiPropertyOptional() @IsOptional() @IsDateString() companyRegistrationDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) companyRegistrationNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) tradeLicenseNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) trn?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() trnExpiryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() licenseExpiryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) managerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) taxableEntityName?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveRegistrationDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) issuingAuthority?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() tradeLicenseVerified?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trnVerified?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) mobile?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) emergencyContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) emergencyContactRelationship?: string;

  @ApiPropertyOptional({ default: 'English' }) @IsOptional() @IsString() preferredLanguage?: string;
  @ApiPropertyOptional({ default: 'Email' }) @IsOptional() @IsString() preferredCommunicationChannel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() photoUrl?: string;

  @ApiPropertyOptional({ type: [SelectedUnitDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedUnitDto)
  selectedUnits?: SelectedUnitDto[];

  @ApiPropertyOptional({ type: [PropertyBillingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyBillingDto)
  propertyBilling?: PropertyBillingDto[];

  @ApiPropertyOptional() @IsOptional() @IsDateString() moveInDate?: string;

  @ApiPropertyOptional({ type: [PaymentMethodDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodDto)
  paymentMethods?: PaymentMethodDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoPayEnabled?: boolean;

  // termsAcceptedAt/termsAcceptedIp are deliberately NOT accepted here — they're server-set the
  // moment termsAccepted flips to true (see RegistrationRequestService.createDraft/updateDraft),
  // never trusted from the client, matching how the applicant's real submitting IP is captured.
  @ApiPropertyOptional({ description: 'Whether the applicant has accepted the active Terms & Conditions version' })
  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}

export class UpdateRegistrationRequestDraftDto extends PartialType(CreateRegistrationRequestDraftDto) {}

export class RegistrationRequestQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({
    enum: RegistrationRequestStatus,
    description:
      'When omitted (and `csQueue` is also omitted), the list defaults to every status except Approved — once approved a request becomes a Customer record and is listed there instead. Pass this explicitly (e.g. status=Approved) to see a specific status, including Approved, such as the Registration Approval screen\'s own Approved/Rejected history tabs.',
  })
  @IsOptional()
  @IsEnum(RegistrationRequestStatus)
  status?: RegistrationRequestStatus;

  @ApiPropertyOptional({ enum: RegistrationChannel })
  @IsOptional()
  @IsEnum(RegistrationChannel)
  channel?: RegistrationChannel;

  @ApiPropertyOptional({
    description:
      'true = only requests awaiting an approve/reject decision (Pending CS Review) or a post-approval deposit verification — the Registration Approval queue, the only screen that exposes Approve/Reject/Verify Deposit. Never combine with `status`; this filters on the same column by a fixed status set instead of one value.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  csQueue?: boolean;

  @ApiPropertyOptional({
    description:
      "The Customer this request became on approval (r.customer.id). Used to resolve a Customer's originating registration request — e.g. the Customer Detail Profile tab. Like `status`, an explicit `customerId` bypasses the default Approved-exclusion, since the one request this ever matches is by definition Approved.",
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  customerId?: number;
}

// ── Action DTOs — spec §7.2 ─────────────────────────────────────────────────────────────────────

export class ActionByDto {
  @ApiPropertyOptional({ description: 'Optional free-text remark carried onto workflowHistory' })
  @IsOptional()
  @IsString()
  comments?: string;
}

export class MandatoryCommentActionDto {
  @ApiProperty({ description: 'Mandatory reason — the action is refused without it' })
  @IsString()
  @IsNotEmpty()
  comments!: string;
}

export class RecordDepositPaymentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  paymentMethod!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  paymentReference!: string;

  @ApiPropertyOptional({ description: 'Receipt filename, when a document was uploaded alongside' })
  @IsOptional()
  @IsString()
  receiptFileRef?: string;

  @ApiPropertyOptional({ description: 'Session-only base64 data URL of the uploaded receipt bytes' })
  @IsOptional()
  @IsString()
  receiptDataUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comments?: string;
}

export class RequestDepositDto {
  @ApiPropertyOptional({
    description: 'Optional components CS explicitly opts into beyond whatever is mandatory',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionalComponents?: string[];
}

export class ToggleExtractedFieldVerifiedDto {
  @ApiProperty()
  @IsBoolean()
  verified!: boolean;

  @ApiPropertyOptional({ description: 'Required when the document is unit-level' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;
}

export class ExtractedFieldDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldName!: string;

  // `@IsOptional()` only skips validation for `undefined`, not `null` — and `null` is exactly what
  // manual-entry mode (OCR-Based Data Entry = No) sends for every field, since there's nothing to
  // extract yet. Without `@ValidateIf`, `@IsString()` still ran against `null` and rejected the
  // whole request, so every manual-entry document silently failed to save its (empty) field set.
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  extractedValue?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  confidence?: number | null;
}

/**
 * Bulk-sets a document's extracted field set — the single write path for OCR, simulated, and
 * manual-entry results alike (source is irrelevant to storage; each field arrives with whatever
 * value/confidence its source produced, `verified: false` always, since verification is a
 * separate, deliberate CS/applicant action).
 */
export class SetExtractedFieldsDto {
  @ApiProperty({ type: [ExtractedFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedFieldDto)
  fields!: ExtractedFieldDto[];

  @ApiPropertyOptional({ description: 'Required when the document is unit-level' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;
}

export class SetExtractedFieldValueDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  extractedValue?: string | null;

  @ApiPropertyOptional({ description: 'Required when the document is unit-level' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;
}

export class UploadRegistrationDocumentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fileRef!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fileData?: string;
}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import {
  CustomerAccountStatus,
  CustomerAccountType,
  CustomerContactType,
  CustomerLegalStructure,
  ResidentType,
} from '../entities/customer.entity';

export class CustomerPaymentMethodDto {
  @ApiProperty() @IsString() id!: string;
  @ApiProperty() @IsString() type!: string;
  @ApiProperty() @IsString() maskedIdentifier!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brandOrBank?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() expiry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountHolderName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiProperty() @IsBoolean() isDefault!: boolean;
}

export class CustomerPropertyBillingDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) propertyId!: number;
  @ApiProperty({ enum: ['Consolidated', 'Per Unit'] }) @IsString() billingType!: 'Consolidated' | 'Per Unit';
}

export class CreateCustomerDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitId!: number;

  @ApiPropertyOptional({ type: [Number], description: 'Additional unit IDs beyond the primary unit (multi-unit customer)' })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  additionalUnitIds?: number[];

  @ApiProperty({ example: 'Ahmed Al Mansoori' })
  @IsString()
  @MaxLength(160)
  fullName!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) salutation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) middleName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) occupation?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() contactEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) alternatePhone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) principalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() principalEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) principalPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() principalIsPrimaryRecipient?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) propertyDocumentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) propertyDocumentReference?: string;

  @ApiPropertyOptional({ enum: CustomerAccountType, default: CustomerAccountType.INDIVIDUAL })
  @IsOptional()
  @IsEnum(CustomerAccountType)
  accountType?: CustomerAccountType;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) contactPersonName?: string;
  @ApiPropertyOptional({ enum: CustomerContactType })
  @IsOptional()
  @IsEnum(CustomerContactType)
  contactType?: CustomerContactType;

  @ApiProperty({ enum: ResidentType })
  @IsEnum(ResidentType)
  residentType!: ResidentType;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isResident?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) nationality?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) maritalStatus?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() photoUrl?: string;

  @ApiPropertyOptional({ example: 'ahmed.almansoori@email.ae' })
  @IsEmail()
  @MaxLength(160)
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+971501234567' })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  mobile?: string;

  @ApiPropertyOptional({ default: 'Email' }) @IsOptional() @IsString() preferredCommunicationChannel?: string;
  @ApiPropertyOptional({ default: 'English' }) @IsOptional() @IsString() preferredLanguage?: string;

  @ApiPropertyOptional({ type: [CustomerPaymentMethodDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerPaymentMethodDto)
  paymentMethods?: CustomerPaymentMethodDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoPayEnabled?: boolean;

  @ApiPropertyOptional({ type: [CustomerPropertyBillingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerPropertyBillingDto)
  propertyBilling?: CustomerPropertyBillingDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) emergencyContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) emergencyContactRelationship?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() registrationDemandId?: number;

  @ApiPropertyOptional({ enum: CustomerAccountStatus, default: CustomerAccountStatus.ACTIVE })
  @IsEnum(CustomerAccountStatus)
  @IsOptional()
  accountStatus?: CustomerAccountStatus;

  @ApiPropertyOptional({ example: 2000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  securityDeposit?: number;

  @ApiPropertyOptional({ example: '2024-03-15' })
  @IsDateString()
  @IsOptional()
  registeredDate?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

/** Company/Trade-License/TRN fields for a Corporate customer — split out of CreateCustomerDto
 *  (which now carries person/contact fields only), mirroring the Customer/Company entity split.
 *  Supplied alongside CreateCustomerDto only when accountType is Corporate; omitted entirely for
 *  an Individual customer, which gets no Company row at all (Customer 1:1 Company, row-absence
 *  models the optionality — see Company entity's own doc comment). */
export class CreateCompanyDto {
  @ApiPropertyOptional({ enum: CustomerLegalStructure })
  @IsOptional()
  @IsEnum(CustomerLegalStructure)
  legalStructure?: CustomerLegalStructure;

  @ApiPropertyOptional() @IsOptional() @IsDateString() companyRegistrationDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) companyRegistrationNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) tradeLicenseNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() licenseExpiryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) managerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() tradeLicenseVerified?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) trn?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() trnExpiryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) taxableEntityName?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveRegistrationDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) issuingAuthority?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trnVerified?: boolean;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}

export class CustomerQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  unitId?: number;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  propertyId?: number;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  communityId?: number;

  @ApiPropertyOptional({ enum: ResidentType })
  @IsEnum(ResidentType)
  @IsOptional()
  residentType?: ResidentType;

  @ApiPropertyOptional({ enum: CustomerAccountStatus })
  @IsEnum(CustomerAccountStatus)
  @IsOptional()
  accountStatus?: CustomerAccountStatus;

  @ApiPropertyOptional({ enum: CustomerAccountType })
  @IsEnum(CustomerAccountType)
  @IsOptional()
  accountType?: CustomerAccountType;

  @ApiPropertyOptional({ description: 'true = overdue accounts only' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isOverdue?: boolean;
}

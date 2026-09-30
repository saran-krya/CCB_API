import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CustomerAccountStatus,
  CustomerAccountType,
  CustomerPaymentMethod,
  ResidentType,
} from '../entities/customer.entity';
import { OccupancyStatus } from '../../unit/entities/unit.entity';

export class CustomerListDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty() fullName!: string;
  @ApiProperty({ enum: ResidentType }) residentType!: ResidentType;
  @ApiPropertyOptional() email!: string | null;
  @ApiPropertyOptional() mobile!: string | null;
  @ApiProperty({ enum: CustomerAccountStatus }) accountStatus!: CustomerAccountStatus;
  @ApiPropertyOptional({ description: 'ISO-8601 date string' }) registeredDate!: string | null;
  @ApiProperty() unitId!: number;
  @ApiProperty() unitNumber!: string;
  @ApiProperty() propertyId!: number;
  @ApiProperty() propertyName!: string;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
}

/** The Owner/Tenant summary composed onto UnitDetailDto (see CustomerService.findByUnitId) — a
 *  deliberately narrower shape than CustomerListDto: no unit/property/community fields, since the
 *  caller (a single unit's own detail response) already has all of those at the top level. */
export class UnitCustomerSummaryDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty() fullName!: string;
  @ApiProperty({ enum: ResidentType }) residentType!: ResidentType;
  @ApiPropertyOptional() email!: string | null;
  @ApiPropertyOptional() mobile!: string | null;
  @ApiProperty({ enum: CustomerAccountStatus }) accountStatus!: CustomerAccountStatus;
}

/**
 * The ONE shared "who is the current customer for this unit" resolution — see
 * CustomerService.resolveCurrentCustomer's own doc comment for the business rule. Every screen
 * that needs to show a unit's billing/reading/occupancy-relevant customer composes this, instead
 * of re-deriving owner/tenant precedence locally (that was the actual bug this DTO fixes: before
 * this existed, MeterService picked owner-over-tenant, backwards from the real business rule).
 */
export class CurrentCustomerResolutionDto {
  @ApiPropertyOptional({ type: () => UnitCustomerSummaryDto, description: 'The customer relevant for billing/reading/occupancy purposes — the active Tenant if one exists, otherwise the active Owner. Null if the unit has neither.' })
  currentCustomer!: UnitCustomerSummaryDto | null;

  @ApiPropertyOptional({ enum: ResidentType, description: 'Which role currentCustomer is playing — OWNER or TENANT. Null if currentCustomer is null.' })
  currentCustomerType!: ResidentType | null;

  @ApiPropertyOptional({ type: () => UnitCustomerSummaryDto, description: 'The active Owner, regardless of whether a Tenant also exists — for screens that need ownership context specifically.' })
  owner!: UnitCustomerSummaryDto | null;

  @ApiPropertyOptional({ type: () => UnitCustomerSummaryDto, description: 'The active Tenant, if one exists.' })
  tenant!: UnitCustomerSummaryDto | null;

  @ApiProperty({ description: 'True when an active Tenant exists but no active Owner does — a data-quality condition per the business rule ("a Tenant cannot exist without an Owner"), surfaced rather than silently guessed at or hidden.' })
  ownerMissing!: boolean;
}

export class CustomerDetailDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty() fullName!: string;
  @ApiProperty({ enum: ResidentType }) residentType!: ResidentType;
  @ApiPropertyOptional() email!: string | null;
  @ApiPropertyOptional() mobile!: string | null;
  @ApiProperty({ enum: CustomerAccountStatus }) accountStatus!: CustomerAccountStatus;
  @ApiPropertyOptional() securityDeposit!: number | null;
  @ApiPropertyOptional({ description: 'ISO-8601 date string' }) registeredDate!: string | null;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  @ApiProperty() unitId!: number;
  @ApiProperty() unitNumber!: string;
  @ApiPropertyOptional() unitType!: string | null;
  @ApiProperty({ enum: OccupancyStatus }) occupancyStatus!: OccupancyStatus;
  @ApiPropertyOptional() masterMeterId!: number | null;
  @ApiPropertyOptional() masterMeterCode!: string | null;
  @ApiPropertyOptional() subMeterId!: number | null;
  @ApiPropertyOptional() subMeterCode!: string | null;
  @ApiProperty() propertyId!: number;
  @ApiProperty() propertyName!: string;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
  @ApiProperty({ enum: CustomerAccountType }) accountType!: CustomerAccountType;
  @ApiPropertyOptional() isResident!: boolean | null;
  @ApiPropertyOptional() contactPersonName!: string | null;
  @ApiPropertyOptional() photoUrl!: string | null;
  @ApiPropertyOptional() gender!: string | null;
  @ApiPropertyOptional({ description: 'ISO-8601 date string' }) dateOfBirth!: string | null;
  @ApiPropertyOptional() nationality!: string | null;
  @ApiPropertyOptional() maritalStatus!: string | null;
  @ApiProperty({ description: "The customer's own explicit preferred-language setting" }) preferredLanguage!: string;
  @ApiPropertyOptional({ type: [Number] }) additionalUnitIds!: number[];
  @ApiPropertyOptional({ type: [Object] }) paymentMethods!: CustomerPaymentMethod[];
  @ApiPropertyOptional({ description: "The customer's own explicit auto-pay preference" }) autoPayEnabled!: boolean;
  @ApiProperty({ description: 'True when this customer is an active Tenant on their primary unit but that unit has no active Owner — a data-quality condition per the business rule ("a Tenant cannot exist without an Owner"), computed the same way as CurrentCustomerResolutionDto.ownerMissing. Always false for an Owner (an Owner being absent from their own unit is not this condition).' })
  ownerMissing!: boolean;
}

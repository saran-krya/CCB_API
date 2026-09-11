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
  @ApiProperty({ description: "The customer's own explicit preferred-language setting" }) preferredLanguage!: string;
  @ApiPropertyOptional({ type: [Number] }) additionalUnitIds!: number[];
  @ApiPropertyOptional({ type: [Object] }) paymentMethods!: CustomerPaymentMethod[];
  @ApiPropertyOptional({ description: "The customer's own explicit auto-pay preference" }) autoPayEnabled!: boolean;
}

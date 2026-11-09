import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { OrganizationStatus, OrganizationType } from '../entities/organization.entity';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Azizi Developments' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'AZD' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiPropertyOptional({ enum: OrganizationType, default: OrganizationType.OTHER })
  @IsEnum(OrganizationType)
  @IsOptional()
  type?: OrganizationType;

  @ApiProperty({ example: 'Fatima Al Suwaidi' })
  @IsString()
  @MaxLength(160)
  primaryContactName!: string;

  @ApiProperty({ example: 'fatima@azizi-example.com' })
  @IsEmail()
  @MaxLength(160)
  primaryContactEmail!: string;

  @ApiPropertyOptional({ example: '+971501234567' })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  primaryContactPhone?: string;

  @ApiPropertyOptional({ example: 'Sheikh Zayed Road, Dubai' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'UAE' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 'Asia/Dubai', default: 'UTC' })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  subscriptionPlanId?: number;

  @ApiPropertyOptional({ example: '2026-11-09' })
  @IsDateString()
  @IsOptional()
  subscriptionStartDate?: string;

  @ApiPropertyOptional({ example: '2027-11-09' })
  @IsDateString()
  @IsOptional()
  subscriptionExpiryDate?: string;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}

export class UpdateOrganizationStatusDto {
  @ApiProperty({ enum: OrganizationStatus })
  @IsEnum(OrganizationStatus)
  status!: OrganizationStatus;
}

export class AssignSubscriptionDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  subscriptionPlanId!: number;

  @ApiProperty({ example: '2026-11-09' })
  @IsDateString()
  subscriptionStartDate!: string;

  @ApiProperty({ example: '2027-11-09' })
  @IsDateString()
  subscriptionExpiryDate!: string;
}

export class OrganizationQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsEnum(OrganizationStatus)
  @IsOptional()
  status?: OrganizationStatus;
}

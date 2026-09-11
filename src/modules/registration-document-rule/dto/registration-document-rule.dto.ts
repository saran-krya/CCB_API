import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import {
  RegistrationDocumentAccountType,
  RegistrationDocumentContactType,
  RegistrationDocumentLevel,
  RegistrationDocumentRequirement,
  RegistrationDocumentResident,
} from '../entities/registration-document-rule.entity';

export class CreateRegistrationDocumentRuleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  documentType!: string;

  @ApiProperty({ enum: RegistrationDocumentLevel })
  @IsEnum(RegistrationDocumentLevel)
  level!: RegistrationDocumentLevel;

  @ApiProperty({ enum: RegistrationDocumentResident })
  @IsEnum(RegistrationDocumentResident)
  appliesToResident!: RegistrationDocumentResident;

  @ApiProperty({ enum: RegistrationDocumentAccountType })
  @IsEnum(RegistrationDocumentAccountType)
  appliesToAccount!: RegistrationDocumentAccountType;

  @ApiProperty({ enum: RegistrationDocumentContactType })
  @IsEnum(RegistrationDocumentContactType)
  appliesToContactType!: RegistrationDocumentContactType;

  @ApiProperty({ enum: RegistrationDocumentRequirement })
  @IsEnum(RegistrationDocumentRequirement)
  requirement!: RegistrationDocumentRequirement;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  displayOrder?: number;
}

export class UpdateRegistrationDocumentRuleDto extends PartialType(CreateRegistrationDocumentRuleDto) {}

export class RegistrationDocumentRuleQueryDto extends BasePaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiPropertyOptional({ enum: RegistrationDocumentLevel })
  @IsOptional()
  @IsEnum(RegistrationDocumentLevel)
  level?: RegistrationDocumentLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}

/**
 * The shape the registration wizard/service actually consumes at runtime: every ACTIVE rule
 * applicable to a given resident/account/contact-type combination. Never filtered by document
 * type here — the caller (registration.service.ts) groups by `level`.
 */
export class ApplicableDocumentRuleQueryDto {
  @ApiProperty({ enum: RegistrationDocumentResident })
  @IsEnum(RegistrationDocumentResident)
  residentType!: RegistrationDocumentResident.OWNER | RegistrationDocumentResident.TENANT;

  @ApiProperty({ enum: RegistrationDocumentAccountType })
  @IsEnum(RegistrationDocumentAccountType)
  accountType!: RegistrationDocumentAccountType.INDIVIDUAL | RegistrationDocumentAccountType.CORPORATE;

  @ApiPropertyOptional({ enum: RegistrationDocumentContactType })
  @IsOptional()
  @IsEnum(RegistrationDocumentContactType)
  contactType?: RegistrationDocumentContactType;
}

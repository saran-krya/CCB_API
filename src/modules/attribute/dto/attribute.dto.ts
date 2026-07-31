import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { AttributeScope, AttributeValueType } from '../entities/attribute.entity';

export const ATTRIBUTE_MODULE_KEYS = [
  'customer',
  'meter',
  'billing',
  'field-operations',
  'user-management',
  'role-management',
  'billing-cycle',
  'tariff',
] as const;

export function isValueValidForType(value: string, valueType: AttributeValueType | undefined): boolean {
  if (typeof value !== 'string') return false;
  if (valueType === AttributeValueType.NUMBER) {
    return value.trim() !== '' && Number.isFinite(Number(value));
  }
  if (valueType === AttributeValueType.BOOLEAN) {
    return value === 'true' || value === 'false';
  }
  return true;
}

export function attributeValueErrorMessage(valueType: AttributeValueType | undefined): string {
  if (valueType === AttributeValueType.NUMBER) return 'value must be a valid number';
  if (valueType === AttributeValueType.BOOLEAN) return 'value must be "true" or "false"';
  return 'value must be a non-empty string';
}

export class UpdateAttributeDto {
  @ApiPropertyOptional({ description: 'New value to persist for this attribute' })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiPropertyOptional({ description: 'Required when editing a cycle-sensitive parameter' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  changeReason?: string;
}

export class AttributeQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: AttributeScope })
  @IsOptional()
  @IsEnum(AttributeScope)
  scope?: AttributeScope;

  @ApiPropertyOptional({ enum: ATTRIBUTE_MODULE_KEYS })
  @IsOptional()
  @IsIn(ATTRIBUTE_MODULE_KEYS)
  module?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupKey?: string;

  @ApiPropertyOptional({ description: 'Exact key match — used to fetch a single named attribute' })
  @IsOptional()
  @IsString()
  key?: string;
}

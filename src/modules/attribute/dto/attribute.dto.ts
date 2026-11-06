import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { AttributeScope, AttributeValueType } from '../entities/attribute.entity';
import { APP_MODULE_KEY } from '../../../common/constants/app-module.constants';

export const ATTRIBUTE_MODULE_KEYS = [
  APP_MODULE_KEY.CUSTOMER,
  APP_MODULE_KEY.METER,
  'billing',
  'field-operations',
  APP_MODULE_KEY.USER_MANAGEMENT,
  APP_MODULE_KEY.ROLE_MANAGEMENT,
  APP_MODULE_KEY.BILLING_CYCLE,
  APP_MODULE_KEY.TARIFF,
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

  @ApiPropertyOptional({
    description:
      'Admin-configured Customer-facing override — null/omitted means no override (Customer falls ' +
      'back to `value`). Same value-type validation as `value`.',
  })
  @IsOptional()
  @IsString()
  customerValue?: string | null;

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

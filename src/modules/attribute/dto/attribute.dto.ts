import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { AttributeScope, AttributeValueType } from '../entities/attribute.entity';

export const ATTRIBUTE_MODULE_KEYS = ['customer', 'meter', 'billing', 'field-operations'] as const;

export class CreateAttributeDto {
  @ApiProperty({ enum: AttributeScope })
  @IsEnum(AttributeScope)
  scope!: AttributeScope;

  @ApiPropertyOptional({ enum: ATTRIBUTE_MODULE_KEYS, description: 'Required when scope=module' })
  @ValidateIf((o) => o.scope === AttributeScope.MODULE)
  @IsIn(ATTRIBUTE_MODULE_KEYS)
  module?: string;

  @ApiPropertyOptional({ description: 'Groups module attributes into one card; required when scope=module' })
  @ValidateIf((o) => o.scope === AttributeScope.MODULE)
  @IsString()
  @IsNotEmpty()
  groupKey?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.scope === AttributeScope.MODULE)
  @IsString()
  @IsNotEmpty()
  groupLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupDescription?: string;

  @ApiProperty({ description: 'Machine name, unique within its scope/module/group' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: AttributeValueType })
  @IsEnum(AttributeValueType)
  valueType!: AttributeValueType;

  @ApiProperty()
  @IsString()
  value!: string;

  @ApiPropertyOptional({ description: 'Label shown when value is true (valueType=boolean only)' })
  @ValidateIf((o) => o.valueType === AttributeValueType.BOOLEAN)
  @IsString()
  @IsNotEmpty()
  trueLabel?: string;

  @ApiPropertyOptional({ description: 'Label shown when value is false (valueType=boolean only)' })
  @ValidateIf((o) => o.valueType === AttributeValueType.BOOLEAN)
  @IsString()
  @IsNotEmpty()
  falseLabel?: string;

  @ApiPropertyOptional({ description: 'Display suffix, e.g. "%", "minutes", "hours"' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  editable?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  displayOrder?: number;
}

export class UpdateAttributeDto extends PartialType(
  OmitType(CreateAttributeDto, ['scope', 'module', 'groupKey', 'key', 'valueType'] as const),
) {
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
}

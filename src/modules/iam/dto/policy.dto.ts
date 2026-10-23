import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PolicyStatementDto {
  @IsString()
  resourceCode!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  actionCodes!: string[];
}

export class CreatePolicyDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PolicyStatementDto)
  statements!: PolicyStatementDto[];
}

export class UpdatePolicyDto extends CreatePolicyDto {}

export class AttachPolicyDto {
  @IsInt()
  policyId!: number;
}

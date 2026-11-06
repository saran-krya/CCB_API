import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Surrounding whitespace is never part of a name: "Finance " and "Finance" must not be two policies, and a
 *  name of only spaces must not pass as a name at all. */
const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PolicyStatementDto {
  @IsString()
  resourceCode!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  actionCodes!: string[];
}

export class CreatePolicyDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name should not be empty' })
  @MaxLength(150)
  name!: string;

  @Transform(trimString)
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

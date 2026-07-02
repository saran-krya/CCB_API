import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateActionDto {
  @ApiProperty({
    required: false,
    example: 1,
  })
  @IsOptional()
  @IsInt()
  screenId?: number;
  
  @ApiProperty({
    example: 'Create',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    example: 'CREATE_USER',
  })
  @IsString()
  code!: string;

  @ApiProperty({
    required: false,
    example: 'Create User',
  })
  @IsOptional()
  @IsString()
  description?: string;


  @ApiProperty({
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

}

export class UpdateActionDto extends PartialType(
  CreateActionDto,
) {}
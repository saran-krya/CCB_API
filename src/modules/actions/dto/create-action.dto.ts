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

  @ApiProperty({
    required: false,
    example: 12,
    description: 'Parent Action id — nests this action as a child in the Role Permission tree. The parent must belong to the same screen and cannot itself already have a parent (one level of nesting only).',
  })
  @IsOptional()
  @IsInt()
  parentActionId?: number;

  @ApiProperty({
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  displayOrder?: number;

}

export class UpdateActionDto extends PartialType(
  CreateActionDto,
) {}
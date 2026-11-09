import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreateSubscriptionPlanDto {
  @ApiProperty({ example: 'Growth' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'GROWTH' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiPropertyOptional({ example: 'Up to 10 staff users, 5 communities' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 10, description: 'null = unlimited' })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsers?: number;

  @ApiPropertyOptional({ example: 5, description: 'null = unlimited' })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxCommunities?: number;

  @ApiPropertyOptional({ example: 25, description: 'null = unlimited' })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxProperties?: number;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSubscriptionPlanDto extends PartialType(CreateSubscriptionPlanDto) {}

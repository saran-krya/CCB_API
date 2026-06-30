import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePropertyDto {
  @ApiProperty()
  communityId!: number;

  @ApiProperty({ example: 'Marina Tower A' })
  @IsString()
  @MaxLength(160)
  propertyName!: string;

  @ApiProperty({ example: 'MTA' })
  @IsString()
  @MaxLength(50)
  propertyCode!: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  status?: boolean;
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { CommunityStatus } from '../entities/community.entity';

export class CreateCommunityDto {
  @ApiProperty({ example: 'Azizi Rivera' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'AZR' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiPropertyOptional({ enum: CommunityStatus, default: CommunityStatus.ACTIVE })
  @IsEnum(CommunityStatus)
  @IsOptional()
  status?: CommunityStatus;

  @ApiPropertyOptional({ example: 'A premier residential community in Dubai.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Al Jadaf, Dubai' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 'Al Jadaf Road, Dubai' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Dubai' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Dubai' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '00000' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  zipCode?: string;

  @ApiPropertyOptional({ example: 'UAE', default: 'UAE' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 'Ahmed Al Mansoori' })
  @IsString()
  @MaxLength(160)
  @IsOptional()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'ahmed@example.com' })
  @IsString()
  @MaxLength(160)
  @IsOptional()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+971501234567' })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  contactPhone?: string;
}

export class UpdateCommunityDto extends PartialType(CreateCommunityDto) {}

export class UpdateCommunityStatusDto {
  @ApiProperty({ enum: CommunityStatus })
  @IsEnum(CommunityStatus)
  status!: CommunityStatus;
}

export class CommunityQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: CommunityStatus })
  @IsEnum(CommunityStatus)
  @IsOptional()
  status?: CommunityStatus;

  @ApiPropertyOptional({ example: 'Dubai' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: '1' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  communityId?: number;
}

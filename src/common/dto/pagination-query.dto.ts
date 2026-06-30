import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { BasePaginationDto } from './base-pagination.dto';

export class PaginationQueryDto extends BasePaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ['search.fullName']?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ['search.email']?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ['search.mobile']?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ['search.role']?: string;
}
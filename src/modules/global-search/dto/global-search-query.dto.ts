import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { MAX_SEARCH_TERM_LENGTH } from '../../../common/utils/search-text.util';

export class GlobalSearchQueryDto {
  @ApiPropertyOptional({ description: 'Search text, matched against each module\'s own identifying fields.' })
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q!: string;

  @ApiPropertyOptional({ description: 'Maximum results PER module/entity type, not a total cap.', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number = 10;
}

// Re-exported so DTO consumers never need to import the raw util constant directly for display/error text.
export { MAX_SEARCH_TERM_LENGTH };

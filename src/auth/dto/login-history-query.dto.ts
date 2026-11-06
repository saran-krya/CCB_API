import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_LIMIT, MAX_LIMIT, MIN_LIMIT } from '../../common/constants/pagination.constants';

/** Query string of GET /auth/login-history (declared so the global whitelist pipe accepts `limit`). */
export class LoginHistoryQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    minimum: MIN_LIMIT,
    maximum: MAX_LIMIT,
    description: 'How many of the most recent sign-ins to return',
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_LIMIT)
  @Max(MAX_LIMIT)
  @IsOptional()
  limit?: number;
}

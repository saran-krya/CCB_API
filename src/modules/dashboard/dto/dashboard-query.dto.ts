import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DashboardConsumptionQueryDto {
  @ApiPropertyOptional({ example: '2026-06', description: 'Month to scope the widget to, format YYYY-MM' })
  @IsOptional()
  @IsString()
  month?: string;
}

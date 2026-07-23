import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EstateSummaryService } from './estate-summary.service';
import {
  HealthResponseDto,
  MissingFilesResponseDto,
  SummaryResponseDto,
  toFailedDtuDto,
  toMissingDtuDto,
  toSummaryResponseDto,
  toTrendPointDto,
  TrendMetric,
  TrendPointDto,
} from './dto/estate-summary-response.dto';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TREND_MAX_DAYS = 90;
const VALID_METRICS: TrendMetric[] = ['all', 'data_quality', 'files_received', 'anomaly_count'];

function assertValidDate(label: string, value: string | undefined): string {
  if (!value || !DATE_PATTERN.test(value)) {
    throw new BadRequestException(`${label} must be a YYYY-MM-DD date`);
  }
  return value;
}


@ApiBearerAuth()
@ApiTags('SFTP Estate Summary')
@Controller({ path: 'sftp', version: '1' })
export class EstateSummaryController {
  constructor(private readonly estateSummary: EstateSummaryService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Estate-wide ingestion summary for one calendar date (defaults to today)' })
  @ApiQuery({ name: 'date', required: false, type: String, example: '2026-07-20' })
  async getSummary(@Query('date') dateParam?: string): Promise<SummaryResponseDto> {
    const date = dateParam ? assertValidDate('date', dateParam) : new Date().toISOString().slice(0, 10);

    const summary = await this.estateSummary.getSummaryForDate(date);
    if (!summary) {
      throw new NotFoundException(`No estate summary exists for ${date} yet`);
    }

    const [missingLogs, failedLogs] = await Promise.all([
      this.estateSummary.getMissingLogsForDate(date),
      this.estateSummary.getFailedLogsForDate(date),
    ]);

    return toSummaryResponseDto(summary, missingLogs, failedLogs);
  }

  @Get('summary/trend')
  @ApiOperation({ summary: 'Daily estate summaries between from_date and to_date (max 90 days)' })
  @ApiQuery({ name: 'from_date', required: true, type: String, example: '2026-06-21' })
  @ApiQuery({ name: 'to_date', required: true, type: String, example: '2026-07-20' })
  @ApiQuery({ name: 'metric', required: false, enum: VALID_METRICS })
  async getTrend(
    @Query('from_date') fromDateParam?: string,
    @Query('to_date') toDateParam?: string,
    @Query('metric') metricParam?: string,
  ): Promise<TrendPointDto[]> {
    const fromDate = assertValidDate('from_date', fromDateParam);
    const toDate = assertValidDate('to_date', toDateParam);

    if (fromDate > toDate) {
      throw new BadRequestException('from_date must not be after to_date');
    }
    const spanDays = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / (24 * 60 * 60 * 1000)) + 1;
    if (spanDays > TREND_MAX_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${TREND_MAX_DAYS} days (got ${spanDays})`);
    }

    const metric = (metricParam ?? 'all') as TrendMetric;
    if (!VALID_METRICS.includes(metric)) {
      throw new BadRequestException(`metric must be one of: ${VALID_METRICS.join(', ')}`);
    }

    const summaries = await this.estateSummary.getSummariesBetween(fromDate, toDate);
    return summaries.map((summary) => toTrendPointDto(summary, metric));
  }

  @Get('health')
  @ApiOperation({ summary: 'Most recent ingestion status and the next scheduled poll time' })
  async getHealth(): Promise<HealthResponseDto> {
    const latest = await this.estateSummary.getLatestSummary();
    return {
      last_ingestion_date: latest?.summaryDate ?? null,
      last_ingestion_status: latest?.ingestionStatus ?? null,
      last_ingestion_completed_at: latest?.ingestionCompletedAt?.toISOString() ?? null,
      files_expected: latest?.filesExpected ?? 0,
      files_received: latest?.filesReceived ?? 0,
      next_scheduled_poll: this.estateSummary.getNextScheduledPoll(),
    };
  }

  @Get('missing-files')
  @ApiOperation({ summary: 'Missing and failed DTU files for one calendar date (defaults to today)' })
  @ApiQuery({ name: 'date', required: false, type: String, example: '2026-07-20' })
  async getMissingFiles(@Query('date') dateParam?: string): Promise<MissingFilesResponseDto> {
    const date = dateParam ? assertValidDate('date', dateParam) : new Date().toISOString().slice(0, 10);

    const [missingLogs, failedLogs] = await Promise.all([
      this.estateSummary.getMissingLogsForDate(date),
      this.estateSummary.getFailedLogsForDate(date),
    ]);

    return {
      missing_count: missingLogs.length,
      failed_count: failedLogs.length,
      missing_files: missingLogs.map(toMissingDtuDto),
      failed_files: failedLogs.map(toFailedDtuDto),
    };
  }
}

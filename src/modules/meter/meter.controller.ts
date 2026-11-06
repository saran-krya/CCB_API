import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import {
  CreateMasterMeterDto,
  CreateSubMeterDto,
  DailyMeterReadingQueryDto,
  DailyMeterReadingSummaryQueryDto,
  DailyReadingsByCommunityQueryDto,
  DailyReadingsTrendQueryDto,
  DownloadErrorReportDto,
  DownloadSuccessReportDto,
  ImportHistoryQueryDto,
  MeterCommunitiesOverviewQueryDto,
  MeterPropertiesOverviewQueryDto,
  MeterUnitsOverviewQueryDto,
  MeterQueryDto,
  SetMeterStatusDto,
  SetReadingApprovalDto,
  UpdateMasterMeterDto,
  UpdateSubMeterDto,
} from './dto/meter.dto';
import { MeterImportType } from './entities/meter-import-type.enum';
import { MeterService } from './meter.service';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { ISO_DATE_LENGTH, MS_PER_DAY, TREND_MAX_DAYS } from '../../common/constants/time.constants';
import { XLSX_CONTENT_TYPE, MAX_IMPORT_FILE_SIZE_BYTES } from '../../common/constants/file.constants';

@ApiBearerAuth()
@ApiTags('Meters')
@Controller({ path: 'meters', version: '1' })
export class MeterController {
  constructor(private readonly meters: MeterService) {}


  @Get('stats')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Get meter dashboard stats' })
  getStats() {
    return this.meters.getStats();
  }

  @Get('communities')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Get paginated, sortable, filterable meter overview for every community' })
  getCommunitiesOverview(@Query() query: MeterCommunitiesOverviewQueryDto) {
    return this.meters.getCommunitiesOverview(query);
  }

  @Get('communities/:communityId')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Get meter detail for one community' })
  @ApiParam({ name: 'communityId', type: Number })
  getCommunityDetail(@Param('communityId', ParseIntPipe) communityId: number) {
    return this.meters.getCommunityDetail(communityId);
  }

  @Get('communities/:communityId/properties')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Get paginated, sortable, filterable meter overview for every property in a community' })
  @ApiParam({ name: 'communityId', type: Number })
  getPropertiesOverview(@Param('communityId', ParseIntPipe) communityId: number, @Query() query: MeterPropertiesOverviewQueryDto) {
    return this.meters.getPropertiesOverview(communityId, query);
  }

  @Get('properties/:propertyId')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Get full meter detail for one property, incl. per-unit sub-meter mapping' })
  @ApiParam({ name: 'propertyId', type: Number })
  getPropertyDetail(@Param('propertyId', ParseIntPipe) propertyId: number) {
    return this.meters.getPropertyDetail(propertyId);
  }

  @Get('properties/:propertyId/units')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Get paginated, sortable, filterable unit-level meter overview for one property' })
  @ApiParam({ name: 'propertyId', type: Number })
  getUnitsOverview(@Param('propertyId', ParseIntPipe) propertyId: number, @Query() query: MeterUnitsOverviewQueryDto) {
    return this.meters.getUnitsOverview(propertyId, query);
  }


  @Get('import-history')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'List recent Master/Sub Meter bulk import runs (file name, counts, duration, status)' })
  getImportHistory(@Query('limit') limit?: string) {
    return this.meters.getImportHistory(limit ? Number(limit) : undefined);
  }

  @Get('import-history/page')
  @Permission(ACTION_CODES.IMPORT_CENTER_VIEW)
  @ApiOperation({ summary: 'Filtered, paginated Master/Sub Meter bulk import history — powers the Import Center screen' })
  getImportHistoryPage(@Query() query: ImportHistoryQueryDto) {
    return this.meters.getImportHistoryPage(query);
  }

  @Get('import-history/metaFilters')
  @Permission(ACTION_CODES.IMPORT_CENTER_VIEW)
  @ApiOperation({ summary: 'Filter option metadata (Type, Status) for the Import Center table filters' })
  getImportHistoryMetaFilters() {
    return this.meters.getImportHistoryMetaFilters();
  }


  @Get('master-meters')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_VIEW)
  @ApiOperation({ summary: 'List master meters with pagination, search and filters' })
  findMasterMeters(@Query() query: MeterQueryDto) {
    return this.meters.findMasterMeters(query);
  }

  @Get('master-meters/metaFilters')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_VIEW)
  @ApiOperation({ summary: 'Filter option metadata (Community, Property, Status) for the Master Meter inventory list' })
  getMasterMeterFilterMetadata() {
    return this.meters.getMeterInventoryFilterMetadata();
  }

  @Get('master-meters/export')
  // METER_EXPORT added (RBAC cleanup audit) — it's a real, seeded, policy-attachable code (METER
  // resource) that previously gated nothing here, so a policy granting it alone could never actually
  // export; additive only, takes nothing away from existing METER_VIEW/METER_INVENTORY_EXPORT holders.
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_EXPORT, ACTION_CODES.METER_EXPORT)
  @ApiOperation({ summary: 'Export master meters to Excel using the configured column list' })
  async exportMasterMeters(@Query() query: MeterQueryDto, @Res() res: Response) {
    const buffer = await this.meters.exportMeters(MeterImportType.MASTER, query);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meters-export.xlsx"' });
    res.send(buffer);
  }

  @Get('master-meters/import-template')
  @Permission(ACTION_CODES.METER_CREATE, ACTION_CODES.METER_INVENTORY_CREATE)
  @ApiOperation({ summary: 'Download the Master Meter bulk import template' })
  async getMasterMeterImportTemplate(@Res() res: Response) {
    const buffer = await this.meters.getImportTemplate(MeterImportType.MASTER);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meter-import-template.xlsx"' });
    res.send(buffer);
  }

  @Post('master-meters/import')
  @Permission(ACTION_CODES.METER_IMPORT, ACTION_CODES.METER_INVENTORY_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import master meters from an uploaded Excel file' })
  importMasterMeters(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: AuthenticatedUser) {
    if (!file) throw new BadRequestException(ERROR_MESSAGES.NO_FILE_UPLOADED);
    return this.meters.importMeters(MeterImportType.MASTER, file.buffer, file.originalname, file.mimetype, user?.sub);
  }

  @Post('master-meters/import/error-report')
  @Permission(ACTION_CODES.METER_IMPORT)
  @ApiOperation({ summary: 'Generate an Excel report of failed rows from a Master Meter import (fix and re-upload)' })
  async downloadMasterMeterErrorReport(@Body() dto: DownloadErrorReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportErrorReport(MeterImportType.MASTER, dto.failedRecords, dto.batchId);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meter-import-errors.xlsx"' });
    res.send(buffer);
  }

  @Post('master-meters/import/success-report')
  @Permission(ACTION_CODES.METER_IMPORT)
  @ApiOperation({ summary: 'Generate an Excel report of the rows successfully created by a Master Meter import' })
  async downloadMasterMeterSuccessReport(@Body() dto: DownloadSuccessReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportSuccessReport(MeterImportType.MASTER, dto.ids);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meter-import-success.xlsx"' });
    res.send(buffer);
  }

  @Get('master-meters/:id')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_VIEW)
  @ApiOperation({ summary: 'Get master meter detail' })
  @ApiParam({ name: 'id', type: Number })
  findOneMasterMeter(@Param('id', ParseIntPipe) id: number) {
    return this.meters.findOneMasterMeter(id);
  }

  @Post('master-meters')
  @Permission(ACTION_CODES.METER_CREATE, ACTION_CODES.METER_INVENTORY_CREATE)
  @ApiOperation({ summary: 'Register a new master meter' })
  createMasterMeter(@Body() dto: CreateMasterMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.createMasterMeter(dto, user?.sub);
  }

  @Patch('master-meters/:id')
  @Permission(ACTION_CODES.METER_INVENTORY_EDIT)
  @ApiOperation({ summary: 'Edit a master meter' })
  @ApiParam({ name: 'id', type: Number })
  updateMasterMeter(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMasterMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.updateMasterMeter(id, dto, user?.sub);
  }

  @Patch('master-meters/:id/status')
  @Permission(ACTION_CODES.METER_INVENTORY_EDIT)
  @ApiOperation({ summary: 'Activate or deactivate a master meter' })
  @ApiParam({ name: 'id', type: Number })
  setMasterMeterStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetMeterStatusDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.setMasterMeterStatus(id, dto, user?.sub);
  }


  @Get('sub-meters')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_VIEW)
  @ApiOperation({ summary: 'List sub meters with pagination, search and filters' })
  findSubMeters(@Query() query: MeterQueryDto) {
    return this.meters.findSubMeters(query);
  }

  @Get('sub-meters/metaFilters')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_VIEW)
  @ApiOperation({ summary: 'Filter option metadata (Community, Property, Status) for the Sub Meter inventory list' })
  getSubMeterFilterMetadata() {
    return this.meters.getMeterInventoryFilterMetadata();
  }

  @Get('sub-meters/export')
  // METER_EXPORT added — see master-meters/export's own comment above for why.
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_EXPORT, ACTION_CODES.METER_EXPORT)
  @ApiOperation({ summary: 'Export sub meters to Excel using the configured column list' })
  async exportSubMeters(@Query() query: MeterQueryDto, @Res() res: Response) {
    const buffer = await this.meters.exportMeters(MeterImportType.SUB, query);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meters-export.xlsx"' });
    res.send(buffer);
  }

  @Get('sub-meters/import-template')
  @Permission(ACTION_CODES.METER_CREATE, ACTION_CODES.METER_INVENTORY_CREATE)
  @ApiOperation({ summary: 'Download the Sub Meter bulk import template' })
  async getSubMeterImportTemplate(@Res() res: Response) {
    const buffer = await this.meters.getImportTemplate(MeterImportType.SUB);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meter-import-template.xlsx"' });
    res.send(buffer);
  }

  @Post('sub-meters/import')
  @Permission(ACTION_CODES.METER_IMPORT, ACTION_CODES.METER_INVENTORY_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import sub meters from an uploaded Excel file' })
  importSubMeters(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: AuthenticatedUser) {
    if (!file) throw new BadRequestException(ERROR_MESSAGES.NO_FILE_UPLOADED);
    return this.meters.importMeters(MeterImportType.SUB, file.buffer, file.originalname, file.mimetype, user?.sub);
  }

  @Post('sub-meters/import/error-report')
  @Permission(ACTION_CODES.METER_IMPORT)
  @ApiOperation({ summary: 'Generate an Excel report of failed rows from a Sub Meter import (fix and re-upload)' })
  async downloadSubMeterErrorReport(@Body() dto: DownloadErrorReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportErrorReport(MeterImportType.SUB, dto.failedRecords, dto.batchId);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meter-import-errors.xlsx"' });
    res.send(buffer);
  }

  @Post('sub-meters/import/success-report')
  @Permission(ACTION_CODES.METER_IMPORT)
  @ApiOperation({ summary: 'Generate an Excel report of the rows successfully created by a Sub Meter import' })
  async downloadSubMeterSuccessReport(@Body() dto: DownloadSuccessReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportSuccessReport(MeterImportType.SUB, dto.ids);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meter-import-success.xlsx"' });
    res.send(buffer);
  }

  @Get('sub-meters/:id')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.METER_INVENTORY_VIEW)
  @ApiOperation({ summary: 'Get sub meter detail' })
  @ApiParam({ name: 'id', type: Number })
  findOneSubMeter(@Param('id', ParseIntPipe) id: number) {
    return this.meters.findOneSubMeter(id);
  }

  @Post('sub-meters')
  @Permission(ACTION_CODES.METER_CREATE, ACTION_CODES.METER_INVENTORY_CREATE)
  @ApiOperation({ summary: 'Register a new sub meter' })
  createSubMeter(@Body() dto: CreateSubMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.createSubMeter(dto, user?.sub);
  }

  @Patch('sub-meters/:id')
  @Permission(ACTION_CODES.METER_INVENTORY_EDIT, ACTION_CODES.METER_MAPPING)
  @ApiOperation({
    summary:
      'Edit a sub meter. METER_INVENTORY_EDIT allows every field; METER_MAPPING alone only allows ' +
      'changing unitId (mapping/unmapping) — MeterService.updateSubMeter enforces the narrower scope',
  })
  @ApiParam({ name: 'id', type: Number })
  updateSubMeter(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.updateSubMeter(id, dto, user?.sub, user?.roleIds);
  }

  @Patch('sub-meters/:id/status')
  @Permission(ACTION_CODES.METER_INVENTORY_EDIT)
  @ApiOperation({ summary: 'Activate or deactivate a sub meter' })
  @ApiParam({ name: 'id', type: Number })
  setSubMeterStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetMeterStatusDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.setSubMeterStatus(id, dto, user?.sub);
  }


  @Get('daily-readings/metaFilters')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Filter option metadata (Community, Property, Unit, Validation Status) for Daily Meter Readings' })
  getDailyMeterReadingsFilterMetadata() {
    return this.meters.getDailyMeterReadingsFilterMetadata();
  }

  @Get('daily-readings/summary')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Dashboard summary (meters expected/received/missing, data quality %) for one date — read-only' })
  getDailyMeterReadingsSummary(@Query() query: DailyMeterReadingSummaryQueryDto) {
    const date = query.date ?? new Date().toISOString().slice(0, ISO_DATE_LENGTH);
    return this.meters.getDailyMeterReadingsSummary(date, query.communityId, query.propertyId);
  }

  // Also VIEW_CUSTOMER: the Customer detail page's own Meter Readings tab calls this scoped to
  // {unitId, date} — the one unit's readings for the customer already being viewed, not browsing
  // the Daily Meter Readings feature itself. Does NOT grant any meter-management action.
  @Get('daily-readings')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.VIEW_CUSTOMER)
  @ApiOperation({ summary: 'Paginated, sortable, filterable Daily Meter Readings list — read-only' })
  getDailyMeterReadings(@Query() query: DailyMeterReadingQueryDto) {
    return this.meters.getDailyMeterReadings(query);
  }

  // Separate from METER_VIEW (read-only) — see this action's own seed-data comment on why
  // approving a reading is a real, distinct write capability, not bundled with viewing.
  @Patch('daily-readings/approve')
  @Permission(ACTION_CODES.METER_READING_APPROVE)
  @ApiOperation({ summary: 'Approve one or more meter readings — persists approval_status=approved, approvedAt, approvedBy' })
  approveReadings(@Body() dto: SetReadingApprovalDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.setReadingApproval(dto, true, user?.sub);
  }

  @Patch('daily-readings/revoke')
  @Permission(ACTION_CODES.METER_READING_APPROVE)
  @ApiOperation({ summary: 'Revoke approval of one or more meter readings — reverts to approval_status=pending' })
  revokeReadingApproval(@Body() dto: SetReadingApprovalDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.setReadingApproval(dto, false, user?.sub);
  }

  @Get('daily-readings/history/:meterId')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Trailing daily-consumption history for one meter — powers the reading detail drawer chart' })
  @ApiParam({ name: 'meterId', type: String })
  getMeterReadingHistory(@Param('meterId') meterId: string, @Query('date') date?: string) {
    return this.meters.getMeterReadingHistory(meterId, date);
  }

  @Get('daily-readings/anomalies-by-community')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Anomaly counts by community and severity for one date — powers the Dashboard chart' })
  getAnomaliesByCommunity(@Query() query: DailyReadingsByCommunityQueryDto) {
    return this.meters.getAnomaliesByCommunity(query.date ?? new Date().toISOString().slice(0, ISO_DATE_LENGTH));
  }

  @Get('daily-readings/reading-status-by-community')
  @Permission(ACTION_CODES.METER_VIEW, ACTION_CODES.SFTP_MONITOR_VIEW)
  @ApiOperation({ summary: 'Valid/anomaly/missing reading counts by community for one date — powers the SFTP Monitor "Reading Status by Community" chart' })
  getReadingStatusByCommunity(@Query() query: DailyReadingsByCommunityQueryDto) {
    return this.meters.getReadingStatusByCommunity(query.date ?? new Date().toISOString().slice(0, ISO_DATE_LENGTH));
  }

  @Get('daily-readings/property-summary')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Per-property Expected/Received/Valid/DataQuality/anomaly-severity breakdown — powers the Property Reading Summary tab' })
  getPropertyReadingSummary(@Query() query: DailyReadingsByCommunityQueryDto) {
    return this.meters.getPropertyReadingSummary(
      query.date ?? new Date().toISOString().slice(0, ISO_DATE_LENGTH),
      query.communityId,
    );
  }

  @Get('daily-readings/trend')
  @Permission(ACTION_CODES.METER_VIEW)
  @ApiOperation({ summary: 'Received-vs-missing reading counts, one point per day in [startDate, endDate] (max 90 days) — powers the Dashboard trend chart' })
  getDailyReadingsTrend(@Query() query: DailyReadingsTrendQueryDto) {
    if (query.startDate > query.endDate) {
      throw new BadRequestException('startDate must not be after endDate');
    }
    const spanDays = Math.round((Date.parse(query.endDate) - Date.parse(query.startDate)) / MS_PER_DAY) + 1;
    if (spanDays > TREND_MAX_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${TREND_MAX_DAYS} days (got ${spanDays})`);
    }
    return this.meters.getDailyReadingsTrend(query.startDate, query.endDate, query.communityId, query.propertyId);
  }
}

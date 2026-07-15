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
  DownloadErrorReportDto,
  DownloadSuccessReportDto,
  ImportHistoryQueryDto,
  MeterQueryDto,
  SetMeterStatusDto,
  UpdateMasterMeterDto,
  UpdateSubMeterDto,
} from './dto/meter.dto';
import { MeterImportType } from './entities/meter-import-type.enum';
import { MeterService } from './meter.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors MeterService's own guard, enforced earlier by Multer

@ApiBearerAuth()
@ApiTags('Meters')
@Controller({ path: 'meters', version: '1' })
export class MeterController {
  constructor(private readonly meters: MeterService) {}

  // ─── Dashboard / drill-down ────────────────────────────────────────────────

  @Get('stats')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Get meter dashboard stats' })
  getStats() {
    return this.meters.getStats();
  }

  @Get('communities')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Get meter overview for every community' })
  getCommunitiesOverview() {
    return this.meters.getCommunitiesOverview();
  }

  @Get('communities/:communityId')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Get meter detail for one community' })
  @ApiParam({ name: 'communityId', type: Number })
  getCommunityDetail(@Param('communityId', ParseIntPipe) communityId: number) {
    return this.meters.getCommunityDetail(communityId);
  }

  @Get('communities/:communityId/properties')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Get meter overview for every property in a community' })
  @ApiParam({ name: 'communityId', type: Number })
  getPropertiesOverview(@Param('communityId', ParseIntPipe) communityId: number) {
    return this.meters.getPropertiesOverview(communityId);
  }

  @Get('properties/:propertyId')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Get full meter detail for one property, incl. per-unit sub-meter mapping' })
  @ApiParam({ name: 'propertyId', type: Number })
  getPropertyDetail(@Param('propertyId', ParseIntPipe) propertyId: number) {
    return this.meters.getPropertyDetail(propertyId);
  }

  // ─── Import history ─────────────────────────────────────────────────────────

  @Get('import-history')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'List recent Master/Sub Meter bulk import runs (file name, counts, duration, status)' })
  getImportHistory(@Query('limit') limit?: string) {
    return this.meters.getImportHistory(limit ? Number(limit) : undefined);
  }

  @Get('import-history/page')
  @Permission('IMPORT_CENTER_VIEW')
  @ApiOperation({ summary: 'Filtered, paginated Master/Sub Meter bulk import history — powers the Import Center screen' })
  getImportHistoryPage(@Query() query: ImportHistoryQueryDto) {
    return this.meters.getImportHistoryPage(query);
  }

  // ─── Master Meters ──────────────────────────────────────────────────────────

  @Get('master-meters')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'List master meters with pagination, search and filters' })
  findMasterMeters(@Query() query: MeterQueryDto) {
    return this.meters.findMasterMeters(query);
  }

  @Get('master-meters/export')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Export master meters to Excel using the configured column list' })
  async exportMasterMeters(@Query() query: MeterQueryDto, @Res() res: Response) {
    const buffer = await this.meters.exportMeters(MeterImportType.MASTER, query);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meters-export.xlsx"' });
    res.send(buffer);
  }

  @Get('master-meters/import-template')
  @Permission('METER_CREATE')
  @ApiOperation({ summary: 'Download the Master Meter bulk import template' })
  async getMasterMeterImportTemplate(@Res() res: Response) {
    const buffer = await this.meters.getImportTemplate(MeterImportType.MASTER);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meter-import-template.xlsx"' });
    res.send(buffer);
  }

  @Post('master-meters/import')
  @Permission('METER_IMPORT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import master meters from an uploaded Excel file' })
  importMasterMeters(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: AuthenticatedUser) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.meters.importMeters(MeterImportType.MASTER, file.buffer, file.originalname, file.mimetype, user?.sub);
  }

  @Post('master-meters/import/error-report')
  @Permission('METER_IMPORT')
  @ApiOperation({ summary: 'Generate an Excel report of failed rows from a Master Meter import (fix and re-upload)' })
  async downloadMasterMeterErrorReport(@Body() dto: DownloadErrorReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportErrorReport(MeterImportType.MASTER, dto.failedRecords, dto.batchId);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meter-import-errors.xlsx"' });
    res.send(buffer);
  }

  @Post('master-meters/import/success-report')
  @Permission('METER_IMPORT')
  @ApiOperation({ summary: 'Generate an Excel report of the rows successfully created by a Master Meter import' })
  async downloadMasterMeterSuccessReport(@Body() dto: DownloadSuccessReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportSuccessReport(MeterImportType.MASTER, dto.ids);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="master-meter-import-success.xlsx"' });
    res.send(buffer);
  }

  @Get('master-meters/:id')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Get master meter detail' })
  @ApiParam({ name: 'id', type: Number })
  findOneMasterMeter(@Param('id', ParseIntPipe) id: number) {
    return this.meters.findOneMasterMeter(id);
  }

  @Post('master-meters')
  @Permission('METER_CREATE')
  @ApiOperation({ summary: 'Register a new master meter' })
  createMasterMeter(@Body() dto: CreateMasterMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.createMasterMeter(dto, user?.sub);
  }

  @Patch('master-meters/:id')
  @Permission('METER_EDIT')
  @ApiOperation({ summary: 'Edit a master meter' })
  @ApiParam({ name: 'id', type: Number })
  updateMasterMeter(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMasterMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.updateMasterMeter(id, dto, user?.sub);
  }

  @Patch('master-meters/:id/status')
  @Permission('METER_EDIT')
  @ApiOperation({ summary: 'Activate or deactivate a master meter' })
  @ApiParam({ name: 'id', type: Number })
  setMasterMeterStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetMeterStatusDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.setMasterMeterStatus(id, dto, user?.sub);
  }

  // ─── Sub Meters ─────────────────────────────────────────────────────────────

  @Get('sub-meters')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'List sub meters with pagination, search and filters' })
  findSubMeters(@Query() query: MeterQueryDto) {
    return this.meters.findSubMeters(query);
  }

  @Get('sub-meters/export')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Export sub meters to Excel using the configured column list' })
  async exportSubMeters(@Query() query: MeterQueryDto, @Res() res: Response) {
    const buffer = await this.meters.exportMeters(MeterImportType.SUB, query);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meters-export.xlsx"' });
    res.send(buffer);
  }

  @Get('sub-meters/import-template')
  @Permission('METER_CREATE')
  @ApiOperation({ summary: 'Download the Sub Meter bulk import template' })
  async getSubMeterImportTemplate(@Res() res: Response) {
    const buffer = await this.meters.getImportTemplate(MeterImportType.SUB);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meter-import-template.xlsx"' });
    res.send(buffer);
  }

  @Post('sub-meters/import')
  @Permission('METER_IMPORT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import sub meters from an uploaded Excel file' })
  importSubMeters(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: AuthenticatedUser) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.meters.importMeters(MeterImportType.SUB, file.buffer, file.originalname, file.mimetype, user?.sub);
  }

  @Post('sub-meters/import/error-report')
  @Permission('METER_IMPORT')
  @ApiOperation({ summary: 'Generate an Excel report of failed rows from a Sub Meter import (fix and re-upload)' })
  async downloadSubMeterErrorReport(@Body() dto: DownloadErrorReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportErrorReport(MeterImportType.SUB, dto.failedRecords, dto.batchId);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meter-import-errors.xlsx"' });
    res.send(buffer);
  }

  @Post('sub-meters/import/success-report')
  @Permission('METER_IMPORT')
  @ApiOperation({ summary: 'Generate an Excel report of the rows successfully created by a Sub Meter import' })
  async downloadSubMeterSuccessReport(@Body() dto: DownloadSuccessReportDto, @Res() res: Response) {
    const buffer = await this.meters.buildImportSuccessReport(MeterImportType.SUB, dto.ids);
    res.set({ 'Content-Type': EXCEL_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="sub-meter-import-success.xlsx"' });
    res.send(buffer);
  }

  @Get('sub-meters/:id')
  @Permission('METER_VIEW')
  @ApiOperation({ summary: 'Get sub meter detail' })
  @ApiParam({ name: 'id', type: Number })
  findOneSubMeter(@Param('id', ParseIntPipe) id: number) {
    return this.meters.findOneSubMeter(id);
  }

  @Post('sub-meters')
  @Permission('METER_CREATE')
  @ApiOperation({ summary: 'Register a new sub meter' })
  createSubMeter(@Body() dto: CreateSubMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.createSubMeter(dto, user?.sub);
  }

  @Patch('sub-meters/:id')
  @Permission('METER_EDIT')
  @ApiOperation({ summary: 'Edit a sub meter, including mapping/unmapping it to a unit' })
  @ApiParam({ name: 'id', type: Number })
  updateSubMeter(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubMeterDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.updateSubMeter(id, dto, user?.sub);
  }

  @Patch('sub-meters/:id/status')
  @Permission('METER_EDIT')
  @ApiOperation({ summary: 'Activate or deactivate a sub meter' })
  @ApiParam({ name: 'id', type: Number })
  setSubMeterStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetMeterStatusDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.meters.setSubMeterStatus(id, dto, user?.sub);
  }
}

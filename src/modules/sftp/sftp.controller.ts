import { BadRequestException, ConflictException, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { SftpService } from './sftp.service';
import { ValidationService } from './validation.service';
import { IngestionService } from './ingestion.service';
import { SftpCronService } from './sftp-cron.service';
import { TriggerSource } from './entities/trigger-source.enum';

@ApiBearerAuth()
@ApiTags('SFTP')
@Controller({ path: 'sftp', version: '1' })
export class SftpController {
  constructor(
    private readonly sftp: SftpService,
    private readonly validation: ValidationService,
    private readonly ingestion: IngestionService,
    private readonly cron: SftpCronService,
  ) {}

  @Get('test')
  @Permission('SFTP_MONITOR_VIEW')
  @ApiOperation({ summary: 'Connect to the configured SFTP server and list files in SFTP_REMOTE_PATH' })
  test() {
    return this.sftp.listFiles();
  }

  @Get('download/:fileName')
  @Permission('SFTP_MONITOR_VIEW')
  @ApiOperation({ summary: 'Download a named file from SFTP_REMOTE_PATH into storage/sftp/temp' })
  @ApiParam({ name: 'fileName', type: String, example: 'DTU_DTU-RIV-01_20260720.csv' })
  download(@Param('fileName') fileName: string) {
    return this.sftp.downloadFile(fileName);
  }

  @Get('parse/:fileName')
  @Permission('SFTP_MONITOR_VIEW')
  @ApiOperation({ summary: 'Download a .csv or .xlsx from SFTP_REMOTE_PATH and parse it into JSON rows' })
  @ApiParam({ name: 'fileName', type: String, example: 'DTU_DTU-RIV-01_20260720.csv' })
  async parse(@Param('fileName') fileName: string) {
    const { localPath } = await this.sftp.downloadFile(fileName);
    return this.sftp.parseFile(localPath);
  }


  @Post('validate/:fileName')
  @Permission('SFTP_MONITOR_VIEW')
  @ApiOperation({ summary: 'Download, parse, and validate a .csv or .xlsx from SFTP_REMOTE_PATH — returns a report only, writes nothing' })
  @ApiParam({ name: 'fileName', type: String, example: 'DTU_DTU-RIV-01_20260720.csv' })
  async validate(@Param('fileName') fileName: string) {
    const { localPath } = await this.sftp.downloadFile(fileName);
    const { rows } = await this.sftp.parseFile(localPath);

    const fileResult = await this.validation.validateFile(localPath, rows);
    const rowResult = await this.validation.validateRows(rows);

    return {
      fileValid: fileResult.valid,
      rowValid: rowResult.valid,
      totalRows: rowResult.totalRows,
      validRows: rowResult.validRows,
      invalidRows: rowResult.invalidRows,

      fileErrors: fileResult.errors,
      errors: rowResult.errors,
    };
  }

  @Post('test-ingest/:fileName')
  // Write-capable (persists meter_readings/sftp_ingestion_logs rows) — deliberately gated on the
  // separate SFTP_MONITOR_TRIGGER action, not SFTP_MONITOR_VIEW, after a confirmed incident where
  // read-only monitoring access alone was enough to trigger a real production write. See
  // SFTP_MONITOR_TRIGGER's own seed-data.ts comment.
  @Permission('SFTP_MONITOR_TRIGGER')
  @ApiOperation({ summary: '[Dev] Manually ingest a single named file — download, parse, validate, hash, and persist. Explicit single-file retrigger: bypasses the already-processed skip, always runs the file through in full.' })
  @ApiParam({ name: 'fileName', type: String, example: 'DTU_DTU-RIV-01_20260720.csv' })
  async testIngest(@Param('fileName') fileName: string) {
    const result = await this.ingestion.ingestFile(fileName, { triggerSource: TriggerSource.MANUAL, isRetrigger: true });
    if (result.outcome === 'duplicate') {
      throw new ConflictException(result.message);
    }
    if (result.outcome === 'rejected_test_file') {
      throw new BadRequestException(result.message);
    }
    return result;
  }

  @Post('run-now')
  // Same reasoning as test-ingest above — this triggers the full ingestion job (real writes) and
  // must not be authorized by read-only monitoring access alone.
  @Permission('SFTP_MONITOR_TRIGGER')
  async runNow() {
    return this.cron.runOnce(TriggerSource.MANUAL);
  }
}

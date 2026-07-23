import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SftpController } from './sftp.controller';
import { EstateSummaryController } from './estate-summary.controller';
import { SftpFileListController } from './sftp-file-list.controller';
import { SftpService } from './sftp.service';
import { ValidationService } from './validation.service';
import { IngestionService } from './ingestion.service';
import { FileMovementService } from './file-movement.service';
import { SftpCronService } from './sftp-cron.service';
import { EstateSummaryService } from './estate-summary.service';
import { SftpFileListService } from './sftp-file-list.service';
import { MeterHierarchyResolverService } from './meter-hierarchy-resolver.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { MeterReading } from './entities/meter-reading.entity';
import { SftpEstateSummary } from './entities/sftp-estate-summary.entity';
import { MasterMeter } from '../meter/entities/master-meter.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { Community } from '../community/entities/community.entity';


@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([SftpIngestionLog, MeterReading, SftpEstateSummary, MasterMeter, SubMeter, Community]),
  ],
  controllers: [SftpController, EstateSummaryController, SftpFileListController],
  providers: [SftpService, ValidationService, IngestionService, FileMovementService, SftpCronService, EstateSummaryService, SftpFileListService, MeterHierarchyResolverService],
  exports: [SftpService, ValidationService, IngestionService, FileMovementService, EstateSummaryService, SftpFileListService],
})
export class SftpModule {}

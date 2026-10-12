import { Module } from '@nestjs/common';
import { MeterReadingUniquenessMigrationService } from './meter-reading-uniqueness-migration.service';

@Module({
  providers: [MeterReadingUniquenessMigrationService],
})
export class MeterReadingUniquenessMigrationModule {}

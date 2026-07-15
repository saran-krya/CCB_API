import { Module } from '@nestjs/common';
import { MeterUniquenessMigrationService } from './meter-uniqueness-migration.service';

@Module({
  providers: [MeterUniquenessMigrationService],
})
export class MeterUniquenessMigrationModule {}

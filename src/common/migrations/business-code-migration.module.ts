import { Module } from '@nestjs/common';
import { BusinessCodeMigrationService } from './business-code-migration.service';

@Module({
  providers: [BusinessCodeMigrationService],
})
export class BusinessCodeMigrationModule {}

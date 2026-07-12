import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const BACKFILL_TABLES = [
  { table: 'communities',    prefix: 'COM' },
  { table: 'properties',     prefix: 'PRP' },
  { table: 'units',          prefix: 'UNT' },
  { table: 'billing_cycle_masters', prefix: 'ILCY' },
  { table: 'tariff_masters', prefix: 'TAR' },
  { table: 'master_meters', prefix: 'MMT' },
  { table: 'sub_meters', prefix: 'SMT' },
] as const;

@Injectable()
export class BusinessCodeMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BusinessCodeMigrationService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const { table, prefix } of BACKFILL_TABLES) {
      try {
        const result = await this.dataSource.query(
          `UPDATE \`${table}\` SET business_code = CONCAT('${prefix}-', LPAD(id, 6, '0')) WHERE business_code IS NULL`,
        );
        const affected: number = result?.affectedRows ?? 0;
        if (affected > 0) {
          this.logger.log(`Backfilled ${affected} business codes in ${table}`);
        }
      } catch {
        // Column not yet created (synchronize hasn't applied) — skip gracefully
      }
    }
  }
}

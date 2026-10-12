import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const TABLE = 'meter_readings';
const INDEX_NAME = 'UQ_meter_readings_sub_meter_reading_date';
const COLUMNS = ['sub_meter_id', 'reading_date'] as const;

@Injectable()
export class MeterReadingUniquenessMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeterReadingUniquenessMigrationService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const [existing] = await this.dataSource.query(
        `SELECT COUNT(*) as cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
        [TABLE, INDEX_NAME],
      );
      if (Number(existing.cnt) > 0) {
        return;
      }

      const duplicates: { sub_meter_id: number; reading_date: string; cnt: number }[] = await this.dataSource.query(
        `SELECT sub_meter_id, reading_date, COUNT(*) as cnt
         FROM \`${TABLE}\`
         WHERE sub_meter_id IS NOT NULL
         GROUP BY sub_meter_id, reading_date
         HAVING COUNT(*) > 1`,
      );

      if (duplicates.length > 0) {
        this.logger.error(
          `Cannot add unique index ${INDEX_NAME} on ${TABLE} (${COLUMNS.join(', ')}): ` +
          `${duplicates.length} violating group(s) found — existing duplicate (sub_meter_id, reading_date) rows must be reconciled first. ` +
          `Examples: ${duplicates.slice(0, 10).map((d) => `sub_meter_id=${d.sub_meter_id} reading_date=${d.reading_date} count=${d.cnt}`).join('; ')}`,
        );
        return;
      }

      const columnList = COLUMNS.map((c) => `\`${c}\``).join(', ');
      await this.dataSource.query(`ALTER TABLE \`${TABLE}\` ADD UNIQUE INDEX \`${INDEX_NAME}\` (${columnList})`);
      this.logger.log(`Added unique index ${INDEX_NAME} on ${TABLE} (${COLUMNS.join(', ')})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to add unique index ${INDEX_NAME} on ${TABLE}: ${message}`);
    }
  }
}

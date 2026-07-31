import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const UNIQUE_INDEXES = [
  { table: 'master_meters', name: 'UQ_master_meters_serial_number', columns: ['serial_number'], unique: true },
  { table: 'master_meters', name: 'UQ_master_meters_dtu_id', columns: ['dtu_id'], unique: true },
  { table: 'master_meters', name: 'UQ_master_meters_property_mbus', columns: ['property_id', 'm_bus_address'], unique: true },
  { table: 'master_meters', name: 'UQ_master_meters_property_id', columns: ['property_id'], unique: true },
  { table: 'sub_meters', name: 'UQ_sub_meters_serial_number', columns: ['serial_number'], unique: true },
  { table: 'sub_meters', name: 'UQ_sub_meters_master_meter_mbus', columns: ['master_meter_id', 'm_bus_address'], unique: true },
  { table: 'sub_meters', name: 'IDX_sub_meters_master_meter_id', columns: ['master_meter_id'], unique: false },
  { table: 'sub_meters', name: 'UQ_sub_meters_unit_id', columns: ['unit_id'], unique: true },
] as const;

const SUPERSEDED_INDEXES = [
  { table: 'master_meters', name: 'IDX_master_meters_property_id' },
] as const;

@Injectable()
export class MeterUniquenessMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeterUniquenessMigrationService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const { table, name } of SUPERSEDED_INDEXES) {
      try {
        const [existing] = await this.dataSource.query(
          `SELECT COUNT(*) as cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
          [table, name],
        );
        if (Number(existing.cnt) === 0) continue;

        await this.dataSource.query(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``);
        this.logger.log(`Dropped superseded index ${name} on ${table}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to drop superseded index ${name} on ${table}: ${message}`);
      }
    }

    for (const { table, name, columns, unique } of UNIQUE_INDEXES) {
      try {
        const [existing] = await this.dataSource.query(
          `SELECT COUNT(*) as cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
          [table, name],
        );
        if (Number(existing.cnt) > 0) continue;

        const columnList = columns.map((c) => `\`${c}\``).join(', ');
        const indexKind = unique ? 'UNIQUE INDEX' : 'INDEX';
        await this.dataSource.query(`ALTER TABLE \`${table}\` ADD ${indexKind} \`${name}\` (${columnList})`);
        this.logger.log(`Added ${unique ? 'unique ' : ''}index ${name} on ${table} (${columns.join(', ')})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to add unique index ${name} on ${table}: ${message}`);
      }
    }
  }
}

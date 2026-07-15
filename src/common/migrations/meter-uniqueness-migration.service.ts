import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Adds the DB-level UNIQUE constraints the Meter Management business model
// actually requires (confirmed with the business owner — see the Meter
// Import enterprise audit): application-layer duplicate checks in
// MeterService.importMeters() cannot protect against two concurrent
// imports both validating against the same pre-import snapshot and both
// choosing the same value — only a real constraint can. Each entry names
// the columns as they exist in TypeORM's naming (snake_case DB columns).
//
// - master_meters.serial_number: globally unique (a physical meter's
//   nameplate serial number is a real hardware identifier)
// - master_meters.dtu_id: globally unique (a tower's physical Data
//   Transfer Unit hardware ID)
// - master_meters.(property_id, m_bus_address): unique per Property, not
//   globally — M-Bus addresses are only meaningful within one wired bus
//   segment, and each Property is its own segment for its Master Meter
// - sub_meters.serial_number: globally unique (same reasoning as Master
//   Meter's serial number)
// - sub_meters.(master_meter_id, m_bus_address): unique per Master Meter,
//   not globally — the Master Meter is the bus segment a Sub Meter's
//   M-Bus address is scoped to
//
// MySQL 8 (confirmed the running version) has no `CREATE INDEX IF NOT
// EXISTS`, so existence is checked against information_schema first —
// this also means re-running this on every boot (as OnApplicationBootstrap
// does) is a cheap no-op once the index exists, not a repeated ALTER.
//
// The two IDX_* entries are NOT part of the uniqueness requirement — they
// exist purely so master_meters.property_id / sub_meters.master_meter_id's
// foreign keys are never solely dependent on one of the composite UNIQUE
// indexes above for InnoDB's "FK column needs a supporting index" rule.
// Without them, `synchronize: true` (dev only) trying to reconcile a
// composite index name mismatch can hit "Cannot drop index ... needed in a
// foreign key constraint" and refuse to boot — a dedicated plain index on
// the FK column alone means the composite index is never load-bearing for
// the FK and can always be freely dropped/recreated.
const UNIQUE_INDEXES = [
  { table: 'master_meters', name: 'UQ_master_meters_serial_number', columns: ['serial_number'], unique: true },
  { table: 'master_meters', name: 'UQ_master_meters_dtu_id', columns: ['dtu_id'], unique: true },
  { table: 'master_meters', name: 'UQ_master_meters_property_mbus', columns: ['property_id', 'm_bus_address'], unique: true },
  { table: 'master_meters', name: 'IDX_master_meters_property_id', columns: ['property_id'], unique: false },
  { table: 'sub_meters', name: 'UQ_sub_meters_serial_number', columns: ['serial_number'], unique: true },
  { table: 'sub_meters', name: 'UQ_sub_meters_master_meter_mbus', columns: ['master_meter_id', 'm_bus_address'], unique: true },
  { table: 'sub_meters', name: 'IDX_sub_meters_master_meter_id', columns: ['master_meter_id'], unique: false },
] as const;

@Injectable()
export class MeterUniquenessMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeterUniquenessMigrationService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
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
        // Deliberately NOT swallowed silently (unlike the business-code
        // backfill this file sits next to) — a failed-to-add uniqueness
        // constraint means the concurrency protection this migration exists
        // for is NOT in place, which is worth surfacing loudly. The most
        // likely real-world cause is pre-existing duplicate data that
        // violates the new constraint; that needs a human to resolve, not
        // a silent skip.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to add unique index ${name} on ${table}: ${message}`);
      }
    }
  }
}

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { SftpIngestionLog } from './sftp-ingestion-log.entity';
import { SubMeter } from '../../meter/entities/sub-meter.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { Property } from '../../property/entities/property.entity';
import { Community } from '../../community/entities/community.entity';

// One row per meter reading parsed out of a CSV — schema only in this
// milestone. No repository/service inserts into this table yet; that's a
// later milestone once the ingestion pipeline actually commits parsed +
// validated rows.
@Entity('meter_readings')
@Index('IDX_meter_readings_meter_id', ['meterId'])
@Index('IDX_meter_readings_reading_date', ['readingDate'])
@Index('IDX_meter_readings_source_file_id', ['sourceFile'])
export class MeterReading extends BaseEntity {
  @Column({ name: 'meter_id', type: 'varchar', length: 100 })
  meterId!: string;

  @Column({ name: 'reading_date', type: 'date' })
  readingDate!: string;

  @Column({ name: 'reading_value', type: 'decimal', precision: 14, scale: 4 })
  readingValue!: string;

  @Column({ name: 'unit', type: 'varchar', length: 20 })
  unit!: string;

  // FK column named explicitly (source_file_id), matching every other
  // ManyToOne in this codebase (see MasterMeter.property / SubMeter.masterMeter
  // for the same pattern) — this is also the physical column
  // IDX_meter_readings_source_file_id above indexes.
  //
  // ON DELETE CASCADE: deleting a SftpIngestionLog row removes every
  // MeterReading that came from that file — a reading can't meaningfully
  // exist once its source ingestion record is gone.
  @ManyToOne(() => SftpIngestionLog, (log) => log.meterReadings, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_file_id' })
  sourceFile!: SftpIngestionLog;

  // Meter hierarchy resolution (meter_id -> SubMeter.businessCode -> Unit ->
  // Property -> Community), populated by MeterHierarchyResolverService at
  // ingestion time. All nullable — a meter_id with no matching SubMeter
  // still gets a MeterReading row, just without these resolved (existing
  // validation/anomaly handling is entirely unaffected either way).
  @ManyToOne(() => SubMeter, { nullable: true })
  @JoinColumn({ name: 'sub_meter_id' })
  subMeter?: SubMeter | null;

  // Named propertyUnit, not `unit` — this entity's own `unit` column above
  // already means "unit of measure" (e.g. "m3"/"kWh"), a different concept
  // from the Unit entity (a physical property unit/apartment).
  @ManyToOne(() => Unit, { nullable: true })
  @JoinColumn({ name: 'unit_id' })
  propertyUnit?: Unit | null;

  @ManyToOne(() => Property, { nullable: true })
  @JoinColumn({ name: 'property_id' })
  property?: Property | null;

  @ManyToOne(() => Community, { nullable: true })
  @JoinColumn({ name: 'community_id' })
  community?: Community | null;
}

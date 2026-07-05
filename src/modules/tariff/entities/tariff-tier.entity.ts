import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Tariff } from './tariff.entity';

@Entity('tariff_tiers')
export class TariffTier extends BaseEntity {
  @ManyToOne(() => Tariff, (tariff) => tariff.tiers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tariff_id' })
  tariff!: Tariff;

  @Column({ name: 'tier_order', type: 'smallint' })
  tierOrder!: number;

  @Column({ name: 'min_kwh', type: 'decimal', precision: 12, scale: 2 })
  minKwh!: number;

  @Column({ name: 'max_kwh', type: 'decimal', precision: 12, scale: 2, nullable: true })
  maxKwh?: number | null;

  @Column({ name: 'rate_per_kwh', type: 'decimal', precision: 10, scale: 4 })
  ratePerKwh!: number;
}

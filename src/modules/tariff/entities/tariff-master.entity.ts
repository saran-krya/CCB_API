import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { TariffVersion } from './tariff-version.entity';

@Entity('tariff_masters')
export class TariffMaster extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @OneToMany(() => TariffVersion, (version) => version.master)
  versions!: TariffVersion[];
}

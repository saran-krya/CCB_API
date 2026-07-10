import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { TariffVersion } from './tariff-version.entity';

// Stable identity for one tariff lineage (TAR-000123 v1.0, v2.0, ...).
// Everything that varies by version — name, rates, fees, scope, status,
// dates — lives on TariffVersion.
//
// Deliberately has no "current version" pointer, unlike BillingCycleMaster.
// A billing cycle has exactly one governing version per property at a time,
// so that pointer has one honest meaning. A tariff lineage does not: the PDF
// (Scenario 5) has an approved successor sit ACTIVE alongside its still-
// ACTIVE parent until the successor's effective date arrives, and several
// other statuses (DRAFT/PENDING/REQUEST_FOR_CORRECTION/REJECTED) are also
// "the current thing to work on" without being terminal. A single-value
// pointer would have to fudge one of those cases, so this master only
// carries what genuinely has one unambiguous value across the whole
// lineage: the business code.
@Entity('tariff_masters')
export class TariffMaster extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @OneToMany(() => TariffVersion, (version) => version.master)
  versions!: TariffVersion[];
}

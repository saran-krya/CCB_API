import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { User } from '../../user/entities/user.entity';
import { TariffTier } from './tariff-tier.entity';

export enum TariffStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  REQUEST_FOR_CORRECTION = 'request_for_correction',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
  EXPIRED = 'expired',
  REJECTED = 'rejected',
}

export enum TariffRateType {
  FLAT = 'flat',
  TIERED = 'tiered',
}

export enum TariffApplicability {
  GLOBAL = 'global',
  PROPERTY = 'property',
  UNIT = 'unit',
}

export enum TariffPenaltyType {
  FLAT = 'flat',
  PERCENTAGE = 'percentage',
}

@Entity('tariffs')
export class Tariff extends BaseEntity {
  // Shared across every version of the same tariff (TAR-001 v1.0, v2.0, ...)
  // — no longer unique, since cloning a new version deliberately reuses it.
  @Column({ name: 'business_code', type: 'varchar', length: 20, nullable: true })
  businessCode?: string | null;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'status', type: 'enum', enum: TariffStatus, default: TariffStatus.DRAFT })
  status!: TariffStatus;

  @Column({ name: 'version', type: 'varchar', length: 10, default: '1.0' })
  version!: string;

  // Self-reference to the version this one was cloned from via the
  // new-version flow (Scenario 5). Null for a tariff's first version.
  @ManyToOne(() => Tariff, { nullable: true, eager: false })
  @JoinColumn({ name: 'parent_tariff_id' })
  parentTariff?: Tariff | null;

  @OneToMany(() => Tariff, (tariff) => tariff.parentTariff)
  childVersions!: Tariff[];

  // Code from the LOV category TARIFF_UNIT_TYPE (Lookup Field Master) —
  // not a native enum, so admins can add unit types without a code change.
  @Column({ name: 'property_type', type: 'varchar', length: 100 })
  propertyType!: string;

  @Column({ name: 'rate_type', type: 'enum', enum: TariffRateType })
  rateType!: TariffRateType;

  @Column({
    name: 'applicability',
    type: 'enum',
    enum: TariffApplicability,
    default: TariffApplicability.GLOBAL,
  })
  applicability!: TariffApplicability;

  @Column({ name: 'flat_rate', type: 'decimal', precision: 10, scale: 4, nullable: true })
  flatRate?: number | null;

  @Column({ name: 'billing_service_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  billingServiceFee!: number;

  @Column({ name: 'activation_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  activationFee!: number;

  @Column({ name: 'security_deposit', type: 'decimal', precision: 10, scale: 2, default: 0 })
  securityDeposit!: number;

  @Column({
    name: 'late_payment_penalty_type',
    type: 'enum',
    enum: TariffPenaltyType,
    default: TariffPenaltyType.FLAT,
  })
  latePaymentPenaltyType!: TariffPenaltyType;

  @Column({ name: 'late_payment_penalty', type: 'decimal', precision: 10, scale: 2, default: 0 })
  latePaymentPenalty!: number;

  @Column({ name: 'disconnection_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  disconnectionFee!: number;

  @Column({ name: 'reconnection_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  reconnectionFee!: number;

  @Column({ name: 'tampering_penalty', type: 'decimal', precision: 10, scale: 2, default: 0 })
  tamperingPenalty!: number;

  @Column({ name: 'bounced_cheque_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  bouncedChequeFee!: number;

  @Column({ name: 'noc_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  nocFee!: number;

  @Column({ name: 'move_out_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  moveOutFee!: number;

  @Column({ name: 'meter_verification_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  meterVerificationFee!: number;

  @Column({ name: 'meter_rental_enabled', type: 'boolean', default: false })
  meterRentalEnabled!: boolean;

  @Column({ name: 'meter_rental_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  meterRentalFee!: number;

  @Column({ name: 'vat', type: 'decimal', precision: 5, scale: 2, default: 5 })
  vat!: number;

  @Column({ name: 'vat_registration_number', type: 'varchar', length: 15, nullable: true })
  vatRegistrationNumber?: string | null;

  @Column({ name: 'vat_applicable_fees', type: 'simple-json', nullable: true })
  vatApplicableFees?: string[] | null;

  @Column({ name: 'effective_from', type: 'date', nullable: true })
  effectiveFrom?: string | null;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo?: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy?: User | null;

  @Column({ name: 'submitted_on', type: 'date', nullable: true })
  submittedOn?: string | null;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy?: User | null;

  @Column({ name: 'approval_date', type: 'date', nullable: true })
  approvalDate?: string | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 100, nullable: true })
  rejectionReason?: string | null;

  @Column({ name: 'rejection_notes', type: 'text', nullable: true })
  rejectionNotes?: string | null;

  @OneToMany(() => TariffTier, (tier) => tier.tariff, { cascade: true })
  tiers!: TariffTier[];

  @ManyToMany(() => Property)
  @JoinTable({
    name: 'tariff_properties',
    joinColumn: { name: 'tariff_id' },
    inverseJoinColumn: { name: 'property_id' },
  })
  properties!: Property[];

  @ManyToMany(() => Unit)
  @JoinTable({
    name: 'tariff_units',
    joinColumn: { name: 'tariff_id' },
    inverseJoinColumn: { name: 'unit_id' },
  })
  units!: Unit[];
}

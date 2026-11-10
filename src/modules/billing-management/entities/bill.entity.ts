import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { BillRun } from '../../bill-run/entities/bill-run.entity';
import { Property } from '../../property/entities/property.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { Customer } from '../../customer/entities/customer.entity';
import { BillingCycleMaster } from '../../billing-cycle/entities/billing-cycle-master.entity';
import { BillingCycleVersion } from '../../billing-cycle/entities/billing-cycle-version.entity';
import { TariffVersion } from '../../tariff/entities/tariff-version.entity';
import { User } from '../../user/entities/user.entity';

// A real, unit-level financial document generated from an APPROVED BillRun — never created,
// approved, or rejected by this module itself (that stays exclusively inside Bill Run Request; see
// billing-management.service.ts's own doc comment). One Bill = one Unit + one BillRun
// (enforced by a DB-level UNIQUE(bill_run_id, unit_id) index, not just application logic — see the
// migration). Once generated, a Bill is a financial snapshot: every value needed to reproduce the
// issued document is copied onto this row at generation time and never recomputed from live master
// data afterward (tariff/customer/cycle-config changes must never silently alter an existing Bill).
export enum BillStatus {
  PENDING_REVIEW = 'pending_review',
  ISSUED = 'issued',
  CANCELLED = 'cancelled',
  // No PAID status — no real payment-received signal exists anywhere in this codebase yet (no
  // Payments module). 'Overdue' is deliberately NOT a stored status either — it's derived at
  // read time only (status === ISSUED && today > billDueDate), see BillingManagementService's
  // getDisplayStatus()-equivalent helper, mirroring the real precedent pattern this design is
  // based on (never a stored/cron-updated status for something purely a function of "now").
}

@Entity('bills')
@Index('IDX_bills_bill_run_unit', ['billRunId', 'unitId'], { unique: true })
@Index('IDX_bills_property', ['propertyId'])
export class Bill extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @ManyToOne(() => BillRun, { nullable: false })
  @JoinColumn({ name: 'bill_run_id' })
  billRun!: BillRun;

  @Column({ name: 'bill_run_id' })
  billRunId!: number;

  @ManyToOne(() => Property, { nullable: false })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({ name: 'property_id' })
  propertyId!: number;

  @ManyToOne(() => Unit, { nullable: false })
  @JoinColumn({ name: 'unit_id' })
  unit!: Unit;

  @Column({ name: 'unit_id' })
  unitId!: number;

  // The current customer at GENERATION time, resolved via the existing resolveCurrentCustomer()
  // rule (active Tenant first, otherwise active Owner) and never accepted from the frontend. A
  // later tenancy change must never retroactively change who an already-generated Bill was for —
  // that's exactly what this FK + the snapshot fields below exist to prevent.
  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @ManyToOne(() => BillingCycleMaster, { nullable: false })
  @JoinColumn({ name: 'billing_cycle_master_id' })
  billingCycleMaster!: BillingCycleMaster;

  @Column({ name: 'billing_cycle_master_id' })
  billingCycleMasterId!: number;

  @ManyToOne(() => BillingCycleVersion, { nullable: false })
  @JoinColumn({ name: 'billing_cycle_version_id' })
  billingCycleVersion!: BillingCycleVersion;

  @Column({ name: 'billing_cycle_version_id' })
  billingCycleVersionId!: number;

  // Copied verbatim from the parent BillRun at generation time — never independently resolved or
  // recomputed. BillRun already owns the one real formula for these four fields
  // (bill-run.service.ts's submitWithinTransaction); duplicating that logic here would risk drift.
  @Column({ name: 'billing_period_start', type: 'date' })
  billingPeriodStart!: string;

  @Column({ name: 'billing_period_end', type: 'date' })
  billingPeriodEnd!: string;

  @Column({ name: 'bill_issue_date', type: 'date' })
  billIssueDate!: string;

  @Column({ name: 'bill_due_date', type: 'date' })
  billDueDate!: string;

  @Column({ name: 'consumption_kwh', type: 'decimal', precision: 14, scale: 4 })
  consumptionKwh!: string;

  // Tariff SNAPSHOT — tariffVersionId alone is insufficient (a TariffVersion can be revised after
  // this Bill is generated). The three *_snapshot columns below are the actual values used in this
  // Bill's calculation, frozen at generation time — never re-read from the live TariffVersion row
  // when displaying or auditing an existing Bill.
  @ManyToOne(() => TariffVersion, { nullable: false })
  @JoinColumn({ name: 'tariff_version_id' })
  tariffVersion!: TariffVersion;

  @Column({ name: 'tariff_version_id' })
  tariffVersionId!: number;

  @Column({ name: 'tariff_rate_snapshot', type: 'decimal', precision: 10, scale: 4 })
  tariffRateSnapshot!: string;

  @Column({ name: 'billing_service_fee_snapshot', type: 'decimal', precision: 10, scale: 2 })
  billingServiceFeeSnapshot!: string;

  @Column({ name: 'vat_rate_snapshot', type: 'decimal', precision: 5, scale: 2 })
  vatRateSnapshot!: string;

  @Column({ name: 'subtotal', type: 'decimal', precision: 12, scale: 2 })
  subtotal!: string;

  @Column({ name: 'vat_amount', type: 'decimal', precision: 12, scale: 2 })
  vatAmount!: string;

  @Column({ name: 'total_due', type: 'decimal', precision: 12, scale: 2 })
  totalDue!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: BillStatus,
    default: BillStatus.PENDING_REVIEW,
  })
  status!: BillStatus;

  @Column({ name: 'generated_at', type: 'datetime' })
  generatedAt!: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'generated_by_id' })
  generatedBy?: User | null;

  @Column({ name: 'generated_by_id', nullable: true })
  generatedById?: number | null;

  @Column({ name: 'issued_at', type: 'datetime', nullable: true })
  issuedAt?: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'issued_by_id' })
  issuedBy?: User | null;

  @Column({ name: 'issued_by_id', nullable: true })
  issuedById?: number | null;

  @Column({ name: 'cancelled_at', type: 'datetime', nullable: true })
  cancelledAt?: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'cancelled_by_id' })
  cancelledBy?: User | null;

  @Column({ name: 'cancelled_by_id', nullable: true })
  cancelledById?: number | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason?: string | null;

  // Reserved now (nullable, unused until a correction/supersession workflow is actually built) so a
  // future correction path never requires a schema migration just to become possible — see this
  // module's design doc, "Correction strategy." Not populated or read anywhere in Phase 1-2.
  // Explicit type: 'int' (unlike every FK-id column above) because this one has no paired
  // @ManyToOne relation for TypeORM's reflect-metadata to infer the column type from — without it,
  // TypeORM infers "Object", which MySQL rejects at DataSource.initialize time (a real, caught
  // bootstrap failure, not a hypothetical).
  @Column({ name: 'replaces_bill_id', type: 'int', nullable: true })
  replacesBillId?: number | null;
}

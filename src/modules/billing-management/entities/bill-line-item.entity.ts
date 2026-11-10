import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Bill } from './bill.entity';

// Only the charge types the current Tariff model can actually produce are supported — no invented
// line types. VAT is represented as its own line item (not header-only) so the reconciliation
// invariant (line items sum to totalDue, see billing-management.service.ts's validateReconciliation)
// is directly verifiable by summing this table's own rows, matching the same
// snapshot-transparency principle BillRun itself already follows.
export enum BillLineItemType {
  CONSUMPTION_CHARGE = 'consumption_charge',
  BILLING_SERVICE_FEE = 'billing_service_fee',
  VAT = 'vat',
}

@Entity('bill_line_items')
@Index('IDX_bill_line_items_bill', ['billId'])
export class BillLineItem extends BaseEntity {
  @ManyToOne(() => Bill, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bill_id' })
  bill!: Bill;

  @Column({ name: 'bill_id' })
  billId!: number;

  @Column({ name: 'line_type', type: 'enum', enum: BillLineItemType })
  lineType!: BillLineItemType;

  @Column({ name: 'description', type: 'varchar', length: 255 })
  description!: string;

  // Nullable — VAT and fixed-fee rows have no meaningful quantity/unitRate pair the way a
  // consumption charge does (quantity = kWh, unitRate = rate per kWh); those two columns are
  // populated only for CONSUMPTION_CHARGE rows.
  @Column({ name: 'quantity', type: 'decimal', precision: 14, scale: 4, nullable: true })
  quantity?: string | null;

  @Column({ name: 'unit_rate', type: 'decimal', precision: 10, scale: 4, nullable: true })
  unitRate?: string | null;

  @Column({ name: 'amount', type: 'decimal', precision: 12, scale: 2 })
  amount!: string;

  // Whether THIS charge's fee key was present in the tariff's vatApplicableFees array at
  // generation time — real, per-line-item VAT applicability, not an assumption that every charge
  // is taxable. See getVatApplicableAmount() in billing-management.service.ts.
  @Column({ name: 'taxable', type: 'boolean', default: false })
  taxable!: boolean;

  @Column({ name: 'display_order', type: 'smallint' })
  displayOrder!: number;
}

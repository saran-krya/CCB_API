import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Bill, BillStatus } from './entities/bill.entity';
import { BillLineItem, BillLineItemType } from './entities/bill-line-item.entity';
import { BillRun, BillRunStatus } from '../bill-run/entities/bill-run.entity';
import { Unit, UnitStatus } from '../unit/entities/unit.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { TariffService } from '../tariff/tariff.service';
import { TariffRateType, TariffVersion } from '../tariff/entities/tariff-version.entity';
import { TariffTier } from '../tariff/entities/tariff-tier.entity';
import { CustomerService } from '../customer/customer.service';
import { AuditService } from '../../audit/audit.service';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { BillQueryDto, CancelBillDto } from './dto/billing-management.dto';

const BILLING_MANAGEMENT_AUDIT_MODULE = 'BILLING_MANAGEMENT';

// This service is deliberately NOT responsible for Bill Run creation, submission, approval,
// rejection, or return-for-correction — that entire workflow lives exclusively in BillRunService /
// bill-run.controller.ts (Bill Run Request). This service's only relationship to that workflow is
// READING BillRun.status === APPROVED as its trigger precondition; it never writes to BillRun.
@Injectable()
export class BillingManagementService {
  private readonly logger = new Logger(BillingManagementService.name);

  constructor(
    @InjectRepository(Bill) private readonly bills: Repository<Bill>,
    @InjectRepository(BillLineItem) private readonly lineItems: Repository<BillLineItem>,
    @InjectRepository(BillRun) private readonly billRuns: Repository<BillRun>,
    @InjectRepository(Unit) private readonly units: Repository<Unit>,
    @InjectRepository(MeterReading) private readonly meterReadings: Repository<MeterReading>,
    @InjectRepository(TariffTier) private readonly tariffTiers: Repository<TariffTier>,
    private readonly tariffService: TariffService,
    private readonly customerService: CustomerService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(query: BillQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.bills
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.property', 'property')
      .leftJoinAndSelect('b.unit', 'unit')
      .leftJoinAndSelect('b.customer', 'customer')
      .leftJoinAndSelect('b.billRun', 'billRun')
      .leftJoinAndSelect('property.community', 'community');

    if (query.billRunId) qb.andWhere('b.billRunId = :billRunId', { billRunId: query.billRunId });
    if (query.propertyId) qb.andWhere('b.propertyId = :propertyId', { propertyId: query.propertyId });
    if (query.unitId) qb.andWhere('b.unitId = :unitId', { unitId: query.unitId });
    if (query.customerId) qb.andWhere('b.customerId = :customerId', { customerId: query.customerId });
    if (query.communityId) qb.andWhere('community.id = :communityId', { communityId: query.communityId });
    if (query.status) qb.andWhere('b.status = :status', { status: query.status });
    if (query.cycleEndDate) qb.andWhere('b.billingPeriodEnd = :cycleEndDate', { cycleEndDate: query.cycleEndDate });
    if (query.search) {
      qb.andWhere('(b.businessCode LIKE :search OR property.name LIKE :search OR unit.unitNumber LIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    const sortBy = query.sortBy ?? 'generatedAt';
    const sortOrder = query.sortOrder ?? 'DESC';
    qb.orderBy(`b.${sortBy}`, sortOrder);

    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: items.map((b) => this.toResponseShape(b)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const bill = await this.bills.findOne({
      where: { id },
      relations: { property: { community: true }, unit: true, customer: true, billRun: true, tariffVersion: true, generatedBy: true, issuedBy: true, cancelledBy: true },
    });
    if (!bill) throw new NotFoundException('Bill not found');
    const lineItems = await this.lineItems.find({ where: { billId: id }, order: { displayOrder: 'ASC' } });
    return { ...this.toResponseShape(bill), lineItems };
  }

  async getSummary(query: Pick<BillQueryDto, 'billRunId' | 'propertyId' | 'cycleEndDate'>) {
    const qb = this.bills.createQueryBuilder('b');
    if (query.billRunId) qb.andWhere('b.billRunId = :billRunId', { billRunId: query.billRunId });
    if (query.propertyId) qb.andWhere('b.propertyId = :propertyId', { propertyId: query.propertyId });
    if (query.cycleEndDate) qb.andWhere('b.billingPeriodEnd = :cycleEndDate', { cycleEndDate: query.cycleEndDate });

    const rows = await qb
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(b.totalDue)', 'totalAmount')
      .groupBy('b.status')
      .getRawMany<{ status: BillStatus; count: string; totalAmount: string | null }>();

    const byStatus: Record<string, { count: number; totalAmount: number }> = {};
    let totalBills = 0;
    let totalBilledAmount = 0;
    for (const r of rows) {
      const count = Number(r.count);
      const amount = Number(r.totalAmount ?? 0);
      byStatus[r.status] = { count, totalAmount: amount };
      totalBills += count;
      totalBilledAmount += amount;
    }

    // Overdue is derived, never stored — count separately using the same rule getDisplayStatus() uses.
    const today = new Date().toISOString().slice(0, 10);
    const overdueQb = this.bills
      .createQueryBuilder('b')
      .where('b.status = :status', { status: BillStatus.ISSUED })
      .andWhere('b.billDueDate < :today', { today });
    if (query.billRunId) overdueQb.andWhere('b.billRunId = :billRunId', { billRunId: query.billRunId });
    if (query.propertyId) overdueQb.andWhere('b.propertyId = :propertyId', { propertyId: query.propertyId });
    if (query.cycleEndDate) overdueQb.andWhere('b.billingPeriodEnd = :cycleEndDate', { cycleEndDate: query.cycleEndDate });
    const overdueCount = await overdueQb.getCount();

    return {
      totalBills,
      totalBilledAmount: Math.round(totalBilledAmount * 100) / 100,
      pendingReviewCount: byStatus[BillStatus.PENDING_REVIEW]?.count ?? 0,
      issuedCount: byStatus[BillStatus.ISSUED]?.count ?? 0,
      cancelledCount: byStatus[BillStatus.CANCELLED]?.count ?? 0,
      overdueCount,
    };
  }

  // The ONLY entry point that creates Bills. Called after BillRun.status transitions to APPROVED
  // (see bill-run.service.ts's approve() method, which calls this directly — Bill Run Request owns
  // the trigger, this service owns what happens next). Idempotent: safe to call more than once for
  // the same billRunId — already-billed units are skipped, never re-generated or duplicated (belt
  // and suspenders alongside the DB-level UNIQUE(bill_run_id, unit_id) constraint, which is the
  // real, final guard against a race).
  //
  // Partial-failure model: one unit's generation failure does NOT abort the whole BillRun's
  // generation — every other billable unit still gets its Bill. A failed unit is recorded and
  // returned in `failed`, never silently dropped. This mirrors Field Inspection's own per-unit
  // independence precedent from earlier this session, and matches the real operational need: a
  // single unit with e.g. no qualifying reading should not block billing for the other 24 units in
  // the same property.
  async generateBillsForBillRun(billRunId: number, actorId?: number) {
    const billRun = await this.billRuns.findOne({ where: { id: billRunId } });
    if (!billRun) throw new NotFoundException('Bill run not found');
    if (billRun.status !== BillRunStatus.APPROVED) {
      throw new BadRequestException('Bills can only be generated for an APPROVED bill run');
    }

    const billableUnits = await this.units.find({
      where: { property: { id: billRun.propertyId }, status: UnitStatus.ACTIVE },
    });
    const unitIds = billableUnits.map((u) => u.id);

    const alreadyBilled = await this.bills.find({ where: { billRunId, unitId: In(unitIds.length ? unitIds : [0]) } });
    const alreadyBilledUnitIds = new Set(alreadyBilled.map((b) => b.unitId));
    const pendingUnits = billableUnits.filter((u) => !alreadyBilledUnitIds.has(u.id));

    if (pendingUnits.length === 0) {
      this.logger.debug(`generateBillsForBillRun(${billRunId}) — nothing to do, every billable unit already has a Bill`);
      return { generated: [], failed: [], alreadyBilled: alreadyBilled.length };
    }

    const tariffByUnitId = await this.tariffService.resolveForUnits(pendingUnits.map((u) => u.id));

    const generated: Bill[] = [];
    const failed: { unitId: number; reason: string }[] = [];

    for (const unit of pendingUnits) {
      try {
        const bill = await this.generateOneBill(billRun, unit, tariffByUnitId.get(unit.id) ?? null, actorId);
        generated.push(bill);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        this.logger.warn(`Bill generation failed for unit ${unit.id} (bill run ${billRunId}): ${reason}`);
        failed.push({ unitId: unit.id, reason });
      }
    }

    await this.auditService.record({
      moduleName: BILLING_MANAGEMENT_AUDIT_MODULE,
      entityId: billRunId,
      action: 'GENERATE',
      newValue: { generatedCount: generated.length, failedCount: failed.length, skippedAlreadyBilled: alreadyBilled.length },
      performedBy: actorId,
    });

    // Bills returned here come straight from generateOneBill()'s own save() — property/unit/
    // customer/billRun relations are NOT loaded on these objects, so toResponseShape()'s derived
    // display fields (propertyName, unitNumber, customerName, etc.) are null in this specific
    // response even though the underlying FK columns are correctly persisted. The numeric/status
    // fields callers actually need right after generation (id, totalDue, consumptionKwh, status,
    // etc.) are all correct. Call GET /billing/bills or GET /billing/bills/:id afterward for the
    // fully-joined shape — deliberately not eager-loading relations here to avoid extra queries on
    // every generation call for fields the immediate caller rarely needs.
    return {
      generated: generated.map((b) => this.toResponseShape(b)),
      failed,
      alreadyBilled: alreadyBilled.length,
    };
  }

  // One Bill = one Unit + one BillRun. Each unit's generation runs in its own transaction — not one
  // giant transaction for the whole BillRun — so one unit's failure can never roll back Bills that
  // already succeeded for sibling units in the same run (see the design doc's "Performance
  // considerations" section: bounded per-property unit counts make this safe, and per-unit
  // transactions keep a single slow/failing unit from blocking the rest).
  private async generateOneBill(billRun: BillRun, unit: Unit, tariffVersion: TariffVersion | null, actorId?: number): Promise<Bill> {
    return this.dataSource.transaction(async (manager) => {
      // Row-locked re-check inside the transaction — the real duplicate-prevention guard, same
      // pattern as BillRunService.submitWithinTransaction's own pessimistic_write check. The
      // pre-filtered `pendingUnits` list above is a fast-path optimization only, never the sole
      // protection; this lock plus the DB UNIQUE index are what actually prevent a race.
      const existing = await manager
        .createQueryBuilder(Bill, 'b')
        .setLock('pessimistic_write')
        .where('b.bill_run_id = :billRunId', { billRunId: billRun.id })
        .andWhere('b.unit_id = :unitId', { unitId: unit.id })
        .getOne();
      if (existing) return existing;

      if (!tariffVersion) throw new BadRequestException(`No active tariff resolves for unit ${unit.id}`);

      const unitCustomers = await this.customerService.findByUnitId(unit.id);
      const { currentCustomer } = this.customerService.resolveCurrentCustomer(unitCustomers);
      if (!currentCustomer) throw new BadRequestException(`No current customer (tenant or owner) resolves for unit ${unit.id}`);

      const consumptionKwh = await this.calculateConsumption(unit.id, billRun.cyclePeriodStart, billRun.cyclePeriodEnd);
      if (consumptionKwh === null) throw new BadRequestException(`No qualifying meter reading found for unit ${unit.id} in this billing period`);
      // Negative consumption must never silently become zero, and must never silently produce an
      // incorrect financial Bill — block generation for this unit outright (Phase 1 guard; real
      // meter rollover/replacement handling is explicitly out of scope until real business data for
      // it exists — see this module's design doc, "Negative consumption").
      if (consumptionKwh < 0) throw new BadRequestException(`Negative consumption (${consumptionKwh} kWh) for unit ${unit.id} — blocked, not billed as zero`);

      const tiers = tariffVersion.rateType === TariffRateType.TIERED
        ? await this.tariffTiers.find({ where: { version: { id: tariffVersion.id } }, order: { tierOrder: 'ASC' } })
        : [];

      const calc = this.calculateCharges(consumptionKwh, tariffVersion, tiers);
      this.validateReconciliation(calc);

      let bill = manager.create(Bill, {
        billRunId: billRun.id,
        propertyId: billRun.propertyId,
        unitId: unit.id,
        customerId: currentCustomer.id,
        billingCycleMasterId: billRun.cycleMasterId,
        billingCycleVersionId: billRun.cycleVersionId,
        billingPeriodStart: billRun.cyclePeriodStart,
        billingPeriodEnd: billRun.cyclePeriodEnd,
        billIssueDate: billRun.billIssueDate,
        billDueDate: billRun.billDueDate,
        consumptionKwh: consumptionKwh.toFixed(4),
        tariffVersionId: tariffVersion.id,
        tariffRateSnapshot: calc.effectiveRate.toFixed(4),
        billingServiceFeeSnapshot: Number(tariffVersion.billingServiceFee ?? 0).toFixed(2),
        vatRateSnapshot: Number(tariffVersion.vat ?? 0).toFixed(2),
        subtotal: calc.subtotal.toFixed(2),
        vatAmount: calc.vatAmount.toFixed(2),
        totalDue: calc.totalDue.toFixed(2),
        // A generated Bill IS the customer invoice — there is no separate manual "Issue" review
        // step in this architecture (Bill Run Request/Register is the only approval gate, and it
        // already happened before generateBillsForBillRun runs at all). Issued at generation time,
        // by whichever actor triggered generation (the Finance approver, via BillRunService.approve()).
        status: BillStatus.ISSUED,
        generatedAt: new Date(),
        generatedById: actorId ?? null,
        issuedAt: new Date(),
        issuedById: actorId ?? null,
      });
      let saved = await manager.save(Bill, bill);
      saved.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.INVOICE, saved.id);
      saved = await manager.save(Bill, saved);

      const lineItemEntities = calc.lineItems.map((li, i) =>
        manager.create(BillLineItem, { billId: saved.id, ...li, displayOrder: i + 1 }),
      );
      await manager.save(BillLineItem, lineItemEntities);

      return saved;
    });
  }

  // Real consumption calculation, reusing the SAME rule already used by MeterService
  // (meter.service.ts: consumption = closing - opening) rather than a second, divergent
  // implementation — see this module's design doc, "Negative consumption," for why this is
  // explicitly flagged rather than silently trusted. "Qualifying readings" = MeterReading rows for
  // this unit with reading_date inside the billing period, ordered by date (same filter shape as
  // BillingReadinessService.getReadingCountsByUnitId, just returning the actual rows here instead
  // of a count, since the value itself is needed, not just presence).
  private async calculateConsumption(unitId: number, periodStart: string, periodEnd: string): Promise<number | null> {
    const readings = await this.meterReadings
      .createQueryBuilder('r')
      .where('r.unit_id = :unitId', { unitId })
      .andWhere('r.reading_date BETWEEN :periodStart AND :periodEnd', { periodStart, periodEnd })
      .orderBy('r.reading_date', 'DESC')
      .getMany();

    if (readings.length === 0) return null;
    const closing = Number(readings[0].readingValue);
    if (readings.length === 1) return null; // no opening reading to diff against
    const opening = Number(readings[readings.length - 1].readingValue);
    return closing - opening;
  }

  private calculateCharges(consumptionKwh: number, tariffVersion: TariffVersion, tiers: TariffTier[]) {
    let consumptionCharge: number;
    let effectiveRate: number;

    if (tariffVersion.rateType === TariffRateType.FLAT) {
      effectiveRate = Number(tariffVersion.flatRate ?? 0);
      consumptionCharge = round2(consumptionKwh * effectiveRate);
    } else {
      consumptionCharge = 0;
      let remaining = consumptionKwh;
      for (const tier of tiers) {
        if (remaining <= 0) break;
        const bandMax = tier.maxKwh != null ? Number(tier.maxKwh) - Number(tier.minKwh) : remaining;
        const bandKwh = Math.min(remaining, bandMax);
        consumptionCharge += bandKwh * Number(tier.ratePerKwh);
        remaining -= bandKwh;
      }
      consumptionCharge = round2(consumptionCharge);
      // Blended effective rate for the snapshot column — informational (the real charge breakdown
      // is the line items themselves), never used to recompute the charge.
      effectiveRate = consumptionKwh > 0 ? round4(consumptionCharge / consumptionKwh) : 0;
    }

    const billingServiceFee = round2(Number(tariffVersion.billingServiceFee ?? 0));
    const subtotal = round2(consumptionCharge + billingServiceFee);

    // VAT applies PER FEE, gated by whether that fee's key is literally present in
    // vatApplicableFees — never assumed for every charge. Confirmed against real, live tariff
    // configuration: the array's real key set today is one-time/ancillary fees only
    // (activationFee, moveOutFee, nocFee, meterVerificationFee, billingServiceFee, meterRentalFee)
    // — 'consumptionCharge'/'flatRate' has never appeared in any real vat_applicable_fees value in
    // this database, so consumption is currently never VAT-gated by this mechanism. This is a real,
    // data-driven finding, not an assumption — see the module's design doc.
    const vatApplicableFees = tariffVersion.vatApplicableFees ?? [];
    const vatRate = Number(tariffVersion.vat ?? 0);
    const consumptionTaxable = vatApplicableFees.includes('consumptionCharge') || vatApplicableFees.includes('flatRate');
    const serviceFeeTaxable = vatApplicableFees.includes('billingServiceFee');

    const vatableAmount = (consumptionTaxable ? consumptionCharge : 0) + (serviceFeeTaxable ? billingServiceFee : 0);
    const vatAmount = round2(vatableAmount * (vatRate / 100));
    const totalDue = round2(subtotal + vatAmount);

    const lineItems: { lineType: BillLineItemType; description: string; quantity: string | null; unitRate: string | null; amount: string; taxable: boolean }[] = [
      {
        lineType: BillLineItemType.CONSUMPTION_CHARGE,
        description: `Consumption Charge (${consumptionKwh.toFixed(2)} kWh)`,
        quantity: consumptionKwh.toFixed(4),
        unitRate: effectiveRate.toFixed(4),
        amount: consumptionCharge.toFixed(2),
        taxable: consumptionTaxable,
      },
      {
        lineType: BillLineItemType.BILLING_SERVICE_FEE,
        description: 'Billing Service Fee',
        quantity: null,
        unitRate: null,
        amount: billingServiceFee.toFixed(2),
        taxable: serviceFeeTaxable,
      },
    ];
    if (vatAmount > 0) {
      lineItems.push({
        lineType: BillLineItemType.VAT,
        description: `VAT (${vatRate}%)`,
        quantity: null,
        unitRate: null,
        amount: vatAmount.toFixed(2),
        taxable: false,
      });
    }

    return { consumptionCharge, billingServiceFee, subtotal, vatAmount, totalDue, effectiveRate, lineItems };
  }

  // The line-item reconciliation invariant, enforced before persisting — mirrors the real principle
  // already established for BillRun-adjacent financial documents this session: every stored amount
  // must be independently reproducible by summing the line items, never trusted as an isolated
  // number. Throws rather than silently persisting a Bill whose numbers don't add up.
  private validateReconciliation(calc: { lineItems: { amount: string }[]; totalDue: number }): void {
    const sum = round2(calc.lineItems.reduce((s, li) => s + Number(li.amount), 0));
    if (Math.abs(sum - calc.totalDue) > 0.01) {
      throw new BadRequestException(`Reconciliation failed: line items sum to ${sum} but totalDue is ${calc.totalDue}`);
    }
  }

  async cancelBill(id: number, dto: CancelBillDto, actorId?: number): Promise<Bill> {
    return this.dataSource.transaction(async (manager) => {
      const bill = await manager.findOne(Bill, { where: { id } });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.status === BillStatus.CANCELLED) {
        throw new BadRequestException('This bill is already cancelled');
      }

      bill.status = BillStatus.CANCELLED;
      bill.cancelledAt = new Date();
      bill.cancelledById = actorId ?? null;
      bill.cancellationReason = dto.reason;
      const saved = await manager.save(Bill, bill);

      await this.auditService.record(
        { moduleName: BILLING_MANAGEMENT_AUDIT_MODULE, entityId: id, action: 'CANCEL', newValue: { status: saved.status, reason: dto.reason }, performedBy: actorId },
        manager,
      );
      return saved;
    });
  }

  // Derived display status — Overdue is NEVER stored, computed the same way at every read site
  // (list, detail, summary counts above) rather than risking drift between a stored flag and this
  // logic. Mirrors the real precedent this design is based on (no cron/daily job).
  getDisplayStatus(bill: Pick<Bill, 'status' | 'billDueDate'>): string {
    if (bill.status !== BillStatus.ISSUED) return bill.status;
    const today = new Date().toISOString().slice(0, 10);
    return bill.billDueDate < today ? 'overdue' : bill.status;
  }

  private toResponseShape(bill: Bill) {
    return {
      id: bill.id,
      businessCode: bill.businessCode ?? null,
      billRunId: bill.billRunId,
      billRunBusinessCode: bill.billRun?.businessCode ?? null,
      propertyId: bill.propertyId,
      propertyName: bill.property?.name ?? null,
      communityId: bill.property?.community?.id ?? null,
      communityName: bill.property?.community?.name ?? null,
      unitId: bill.unitId,
      unitNumber: bill.unit?.unitNumber ?? null,
      customerId: bill.customerId,
      customerName: bill.customer ? `${bill.customer.fullName ?? ''}`.trim() || null : null,
      billingCycleMasterId: bill.billingCycleMasterId,
      billingCycleVersionId: bill.billingCycleVersionId,
      billingPeriodStart: bill.billingPeriodStart,
      billingPeriodEnd: bill.billingPeriodEnd,
      billIssueDate: bill.billIssueDate,
      billDueDate: bill.billDueDate,
      consumptionKwh: bill.consumptionKwh,
      tariffVersionId: bill.tariffVersionId,
      tariffRateSnapshot: bill.tariffRateSnapshot,
      billingServiceFeeSnapshot: bill.billingServiceFeeSnapshot,
      vatRateSnapshot: bill.vatRateSnapshot,
      subtotal: bill.subtotal,
      vatAmount: bill.vatAmount,
      totalDue: bill.totalDue,
      status: bill.status,
      displayStatus: this.getDisplayStatus(bill),
      generatedAt: bill.generatedAt,
      generatedById: bill.generatedById ?? null,
      issuedAt: bill.issuedAt ?? null,
      issuedById: bill.issuedById ?? null,
      cancelledAt: bill.cancelledAt ?? null,
      cancelledById: bill.cancelledById ?? null,
      cancellationReason: bill.cancellationReason ?? null,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

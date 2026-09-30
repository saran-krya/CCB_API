import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingCycleService } from '../billing-cycle/billing-cycle.service';
import { TariffService } from '../tariff/tariff.service';
import { CustomerService } from '../customer/customer.service';
import { Property } from '../property/entities/property.entity';
import { Unit, UnitStatus } from '../unit/entities/unit.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { MeterReading, ReadingApprovalStatus, ReadingValidationStatus } from '../sftp/entities/meter-reading.entity';
import { AnomalySeverity } from '../sftp/validation.service';
import { BillingReadinessQueryDto } from './dto/billing-readiness.dto';

export enum BillingReadinessStatus {
  READY = 'ready',
  ON_HOLD = 'on_hold',
  NOT_READY = 'not_ready',
}

// Every distinct reason a property can fail to reach READY, in the exact strict-precedence order
// this feature evaluates them (see BillingReadinessService.evaluateProperty's own doc comment).
// Each maps 1:1 to one of the confirmed Phase 1 business rules — see
// BILLING_READINESS_BUSINESS_RULES_CONFIRMATION.md items 1-7; nothing here is invented beyond
// that document.
export enum BillingReadinessReason {
  NO_BILLING_CYCLE = 'no_billing_cycle',
  CYCLE_NOT_CLOSED = 'cycle_not_closed',
  MISSING_TARIFF = 'missing_tariff',
  MISSING_METER_MAPPING = 'missing_meter_mapping',
  MISSING_READING = 'missing_reading',
  CRITICAL_OR_HIGH_ANOMALY = 'critical_or_high_anomaly',
  MEDIUM_OR_LOW_ANOMALY = 'medium_or_low_anomaly',
}

export interface BillingReadinessItem {
  propertyId: number;
  propertyName: string;
  propertyCode: string | null;
  communityId: number;
  communityName: string;
  cyclePeriodStart: string | null;
  cyclePeriodEnd: string | null;
  status: BillingReadinessStatus;
  reasons: BillingReadinessReason[];
  billableUnits: number;
  occupiedUnits: number;
  unitsMissingTariff: number;
  unitsMissingMeterMapping: number;
  unitsMissingReading: number;
  criticalAnomalies: number;
  highAnomalies: number;
  mediumAnomalies: number;
  lowAnomalies: number;
}

@Injectable()
export class BillingReadinessService {
  constructor(
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(Unit) private readonly units: Repository<Unit>,
    @InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>,
    @InjectRepository(MeterReading) private readonly meterReadings: Repository<MeterReading>,
    private readonly billingCycleService: BillingCycleService,
    private readonly tariffService: TariffService,
    private readonly customerService: CustomerService,
  ) {}

  async getReadiness(query: BillingReadinessQueryDto): Promise<BillingReadinessItem[]> {
    const properties = await this.properties.find({
      where: {
        ...(query.propertyId ? { id: query.propertyId } : {}),
        ...(query.communityId ? { community: { id: query.communityId } } : {}),
      },
      relations: ['community'],
      order: { name: 'ASC' },
    });

    return Promise.all(properties.map((property) => this.evaluateProperty(property)));
  }

  /** Strict precedence, per BILLING_READINESS_BUSINESS_RULES_CONFIRMATION.md item 1:
   *  NOT READY beats ON HOLD beats READY. A property is downgraded by the FIRST rule it fails,
   *  not by how many rules it fails — evaluation order below matches that document's own ordering
   *  (cycle -> tariff -> meter mapping -> reading -> critical/high anomaly -> medium/low anomaly).
   *  Computed live on every call — no persistence, no caching (item 11). */
  private async evaluateProperty(property: Property): Promise<BillingReadinessItem> {
    const reasons: BillingReadinessReason[] = [];

    const billableUnits = await this.units.find({
      where: { property: { id: property.id }, status: UnitStatus.ACTIVE },
    });
    const unitIds = billableUnits.map((u) => u.id);

    const cycleInfo = await this.billingCycleService.getReadingPeriodForProperty(property.id);
    if (!cycleInfo) {
      reasons.push(BillingReadinessReason.NO_BILLING_CYCLE);
    } else if (!cycleInfo.closed) {
      reasons.push(BillingReadinessReason.CYCLE_NOT_CLOSED);
    }

    const [tariffResults, subMeterByUnitId, readingCountByUnitId, anomalyCounts, customersByUnit] = await Promise.all([
      this.resolveTariffForUnits(unitIds),
      this.getMappedSubMetersByUnitId(unitIds),
      cycleInfo ? this.getReadingCountsByUnitId(unitIds, cycleInfo.periodStart, cycleInfo.periodEnd) : Promise.resolve(new Map<number, number>()),
      cycleInfo ? this.getUnresolvedAnomalyCounts(property.id, cycleInfo.periodStart, cycleInfo.periodEnd) : Promise.resolve(null),
      this.customerService.findByUnitIds(unitIds),
    ]);

    // Informational only, per BILLING_READINESS_BUSINESS_RULES_CONFIRMATION.md item 6 — the
    // active Customer.unit relationship (not Unit.occupancyStatus) is the source of truth, and it
    // never contributes to `reasons`/status below.
    const occupiedUnits = unitIds.filter((id) => (customersByUnit.get(id)?.length ?? 0) > 0).length;

    const unitsMissingTariff = unitIds.filter((id) => !tariffResults.get(id)).length;
    if (unitsMissingTariff > 0) reasons.push(BillingReadinessReason.MISSING_TARIFF);

    const unitsMissingMeterMapping = unitIds.filter((id) => !subMeterByUnitId.has(id)).length;
    if (unitsMissingMeterMapping > 0) reasons.push(BillingReadinessReason.MISSING_METER_MAPPING);

    // A unit missing entirely from the meter-mapping check is already NOT READY above — only
    // units that ARE mapped are additionally checked for "did a reading actually arrive," so an
    // unmapped unit is never double-counted as also missing a reading.
    const mappedUnitIds = unitIds.filter((id) => subMeterByUnitId.has(id));
    const unitsMissingReading = mappedUnitIds.filter((id) => (readingCountByUnitId.get(id) ?? 0) === 0).length;
    if (unitsMissingReading > 0) reasons.push(BillingReadinessReason.MISSING_READING);

    const critical = anomalyCounts?.critical ?? 0;
    const high = anomalyCounts?.high ?? 0;
    const medium = anomalyCounts?.medium ?? 0;
    const low = anomalyCounts?.low ?? 0;

    if (critical > 0 || high > 0) reasons.push(BillingReadinessReason.CRITICAL_OR_HIGH_ANOMALY);
    else if (medium > 0 || low > 0) reasons.push(BillingReadinessReason.MEDIUM_OR_LOW_ANOMALY);

    const status = this.deriveStatus(reasons);

    return {
      propertyId: property.id,
      propertyName: property.name,
      propertyCode: property.businessCode ?? property.code ?? null,
      communityId: property.community.id,
      communityName: property.community.name,
      cyclePeriodStart: cycleInfo?.periodStart ?? null,
      cyclePeriodEnd: cycleInfo?.periodEnd ?? null,
      status,
      reasons,
      billableUnits: unitIds.length,
      occupiedUnits,
      unitsMissingTariff,
      unitsMissingMeterMapping,
      unitsMissingReading,
      criticalAnomalies: critical,
      highAnomalies: high,
      mediumAnomalies: medium,
      lowAnomalies: low,
    };
  }

  private deriveStatus(reasons: BillingReadinessReason[]): BillingReadinessStatus {
    const notReadyReasons = new Set<BillingReadinessReason>([
      BillingReadinessReason.NO_BILLING_CYCLE,
      BillingReadinessReason.CYCLE_NOT_CLOSED,
      BillingReadinessReason.MISSING_TARIFF,
      BillingReadinessReason.MISSING_METER_MAPPING,
      BillingReadinessReason.MISSING_READING,
      BillingReadinessReason.CRITICAL_OR_HIGH_ANOMALY,
    ]);
    if (reasons.some((r) => notReadyReasons.has(r))) return BillingReadinessStatus.NOT_READY;
    if (reasons.includes(BillingReadinessReason.MEDIUM_OR_LOW_ANOMALY)) return BillingReadinessStatus.ON_HOLD;
    return BillingReadinessStatus.READY;
  }

  /** Reuses TariffService.resolveForUnits — the batched sibling of resolveForUnit, same
   *  precedence/matching rule, computed via a fixed number of bulk queries instead of one
   *  resolveForUnit call (itself up to 4 queries) per billable unit. Was previously N+1 here
   *  (one resolveForUnit call per unit); resolveForUnits returns the exact same per-unit result,
   *  just without the per-unit round trips. */
  private async resolveTariffForUnits(unitIds: number[]): Promise<Map<number, boolean>> {
    const result = new Map<number, boolean>();
    const resolved = await this.tariffService.resolveForUnits(unitIds);
    for (const [unitId, tariff] of resolved) result.set(unitId, !!tariff);
    return result;
  }

  private async getMappedSubMetersByUnitId(unitIds: number[]): Promise<Map<number, SubMeter>> {
    const map = new Map<number, SubMeter>();
    if (unitIds.length === 0) return map;
    const subMeters = await this.subMeters.find({ where: { unit: { id: In(unitIds) } }, relations: ['unit'] });
    for (const s of subMeters) {
      if (s.unit) map.set(s.unit.id, s);
    }
    return map;
  }

  /** Reading presence within the cycle's reading window — the range-scoped counterpart to the
   *  existing single-date getPropertyReadingSummary/getAnomaliesByCommunity in MeterService (which
   *  stay untouched; this is intentionally its own query, scoped per-unit rather than per-property,
   *  since readiness needs to know WHICH units are missing a reading, not just a property total). */
  private async getReadingCountsByUnitId(unitIds: number[], periodStart: string, periodEnd: string): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (unitIds.length === 0) return map;
    const rows = await this.meterReadings
      .createQueryBuilder('r')
      .select('r.unit_id', 'unitId')
      .addSelect('COUNT(*)', 'count')
      .where('r.unit_id IN (:...unitIds)', { unitIds })
      .andWhere('r.reading_date BETWEEN :periodStart AND :periodEnd', { periodStart, periodEnd })
      .groupBy('r.unit_id')
      .getRawMany<{ unitId: number; count: string }>();
    for (const row of rows) map.set(row.unitId, Number(row.count));
    return map;
  }

  /** "Unresolved" per BILLING_READINESS_BUSINESS_RULES_CONFIRMATION.md item 3: an anomaly whose
   *  reading has not yet been approved. MeterReading has no separate "anomaly resolved" flag distinct
   *  from approvalStatus — approving the reading IS what resolves the anomaly for readiness purposes,
   *  consistent with the confirmed rule ("resolved/approved issues do not block readiness"). */
  private async getUnresolvedAnomalyCounts(
    propertyId: number,
    periodStart: string,
    periodEnd: string,
  ): Promise<{ critical: number; high: number; medium: number; low: number }> {
    const rows = await this.meterReadings
      .createQueryBuilder('r')
      .select('r.anomaly_severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .where('r.property_id = :propertyId', { propertyId })
      .andWhere('r.reading_date BETWEEN :periodStart AND :periodEnd', { periodStart, periodEnd })
      .andWhere('r.validation_status = :validationStatus', { validationStatus: ReadingValidationStatus.ANOMALY })
      .andWhere('r.approval_status = :approvalStatus', { approvalStatus: ReadingApprovalStatus.PENDING })
      .groupBy('r.anomaly_severity')
      .getRawMany<{ severity: AnomalySeverity; count: string }>();

    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const row of rows) {
      if (row.severity === AnomalySeverity.CRITICAL) counts.critical = Number(row.count);
      else if (row.severity === AnomalySeverity.HIGH) counts.high = Number(row.count);
      else if (row.severity === AnomalySeverity.MEDIUM) counts.medium = Number(row.count);
      else if (row.severity === AnomalySeverity.LOW) counts.low = Number(row.count);
    }
    return counts;
  }
}

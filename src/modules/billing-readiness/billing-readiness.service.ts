import { Injectable, NotFoundException } from '@nestjs/common';
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
import { BillRun } from '../bill-run/entities/bill-run.entity';
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
  // The exact BillingCycleVersion this property's CURRENT cycle resolves to (same id
  // BillRun.cycleVersionId is stamped with at submission time) — null when no cycle is
  // configured. Exists so a caller can tell "this property's current cycle" apart from any other
  // cycle the same property was billed under previously; matching on dates alone is not reliable
  // for that (see BillingReadinessDashboard's own "Billed" badge, which this field fixes).
  cycleVersionId: number | null;
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
    @InjectRepository(BillRun) private readonly billRuns: Repository<BillRun>,
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
      cycleVersionId: cycleInfo?.versionId ?? null,
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

  /** Missed Reading Recovery — the real check for "a reading turned up for a date that was never
   *  billed; what billing-cycle version does it belong to, and is that period already billed or
   *  otherwise eligible?" Resolves which billing-cycle version a specific, already-recorded reading
   *  date belongs to (via BillingCycleService.resolveVersionForReadingDate, which already fully
   *  implements the approved Option A parent-child overlap resolution and 'none'/'ambiguous'
   *  sentinels), then delegates every actual readiness check to the existing
   *  evaluateHistoricalCycle(propertyId, cycleVersionId) below — this method adds NO new readiness/
   *  tariff/occupant/duplicate-bill logic of its own, only the date-to-version resolution step in
   *  front of it.
   *
   *  This is a READ-ONLY report, not a submission flow — there is no separate historical Bill Run
   *  to submit here. A recovered reading that resolves to an unbilled past period is billed, if at
   *  all, through the existing, single, routine Bill Run process once that is operationally
   *  appropriate (see this module's own doc comments on why a standalone historical submission
   *  workflow was deliberately NOT built). A caller never supplies a cycleVersionId directly — only
   *  the reading's own date, so a user is never asked to manually pick a deprecated version.
   *  'none'/'ambiguous' resolution results are reported explicitly as blocking reasons, never a
   *  guess and never a silent fallback to any other cycle. */
  async checkRecoveredReadingEligibility(propertyId: number, readingDate: string): Promise<{
    propertyId: number;
    propertyName: string;
    propertyCode: string | null;
    readingDate: string;
    resolution: 'resolved' | 'none' | 'ambiguous';
    cycleVersionId: number | null;
    periodStart: string;
    periodEnd: string;
    ageDays: number;
    eligibleForBilling: boolean;
    blockingReasons: string[];
    missingReadingMeterIds: string[];
    existingBillRun: { id: number; businessCode: string | null; status: string } | null;
    units: Array<{
      unitId: number;
      unitNumber: string;
      hasQualifyingReading: boolean;
      meterBusinessCode: string | null;
      tariffStatus: 'resolved' | 'no_match' | 'ambiguous';
      tariffVersionId: number | null;
      resolvedCustomer: { id: number; businessCode: string | null; fullName: string } | null;
      occupantVerificationRequired: boolean;
    }>;
  }> {
    const property = await this.properties.findOne({ where: { id: propertyId }, relations: ['community'] });
    if (!property) throw new NotFoundException('Property not found');

    const resolution = await this.billingCycleService.resolveVersionForReadingDate(propertyId, readingDate);

    if (resolution === 'none' || resolution === 'ambiguous') {
      return {
        propertyId: property.id,
        propertyName: property.name,
        propertyCode: property.businessCode ?? property.code ?? null,
        readingDate,
        resolution,
        cycleVersionId: null,
        periodStart: '',
        periodEnd: '',
        ageDays: 0,
        eligibleForBilling: false,
        blockingReasons: [
          resolution === 'none'
            ? `No billing-cycle version covers ${readingDate} for this property — the reading cannot be resolved to a billing period`
            : `More than one billing-cycle version's computed reading period covers ${readingDate} — this cannot be resolved automatically and requires manual review of the property's billing-cycle configuration before recovery can proceed`,
        ],
        missingReadingMeterIds: [],
        existingBillRun: null,
        units: [],
      };
    }

    // Delegates to the existing, already-tested evaluateHistoricalCycle for every real check — this
    // method's own job ends at date-to-version resolution. CRITICAL: passes resolution's own
    // periodStart/periodEnd explicitly, rather than letting evaluateHistoricalCycle re-derive them
    // from the version id alone. A version that is STILL the property's current one (e.g. Grand
    // Tower A's version 22) recurs a genuinely different period every month for as long as it stays
    // current (getReadingPeriodForProperty always anchors to "today," confirmed in
    // resolveVersionForReadingDate's own doc comment) — re-deriving "the period for version 22"
    // independently here would silently return THIS month's occurrence instead of the specific past
    // month resolveVersionForReadingDate already correctly matched the reading date against. Passing
    // the already-correct period through explicitly is what prevents that exact regression.
    const evaluated = await this.evaluateHistoricalCycle(propertyId, resolution.versionId, {
      periodStart: resolution.periodStart,
      periodEnd: resolution.periodEnd,
      masterId: resolution.masterId,
    });
    return {
      ...evaluated,
      readingDate,
      resolution: 'resolved',
      cycleVersionId: evaluated.cycleVersionId,
    };
  }

  /** Per-unit detail for a past/recovered billing-cycle period — deliberately its own shape, not
   *  BillingReadinessItem: a recovery check needs things the live readiness item never does
   *  (missing meter IDENTIFIERS not just a count, per-unit tariff ambiguity, and the resolved
   *  customer's occupant-verification status — see that field's own doc comment below for why it's
   *  always true, not a per-unit computed flag).
   *
   *  `periodOverride` — when the caller (checkRecoveredReadingEligibility) has ALREADY resolved the
   *  exact correct period via BillingCycleService.resolveVersionForReadingDate, it is passed here
   *  explicitly rather than letting this method re-derive "the period for cycleVersionId"
   *  independently. This matters specifically for a version that is STILL the property's current
   *  one: getReadingPeriodForProperty always anchors to "today" and would silently return THIS
   *  month's occurrence of that version's day-rule, not the specific past month a recovered
   *  reading's own date actually falls in — passing the override is what prevents that exact
   *  regression. An explicit-id caller with no override keeps the prior re-derivation behavior
   *  unchanged. */
  async evaluateHistoricalCycle(
    propertyId: number,
    cycleVersionId: number,
    periodOverride?: { periodStart: string; periodEnd: string; masterId: number },
  ): Promise<{
    propertyId: number;
    propertyName: string;
    propertyCode: string | null;
    cycleVersionId: number;
    periodStart: string;
    periodEnd: string;
    ageDays: number;
    eligibleForBilling: boolean;
    blockingReasons: string[];
    missingReadingMeterIds: string[];
    existingBillRun: { id: number; businessCode: string | null; status: string } | null;
    units: Array<{
      unitId: number;
      unitNumber: string;
      hasQualifyingReading: boolean;
      meterBusinessCode: string | null;
      tariffStatus: 'resolved' | 'no_match' | 'ambiguous';
      tariffVersionId: number | null;
      resolvedCustomer: { id: number; businessCode: string | null; fullName: string } | null;
      occupantVerificationRequired: boolean;
    }>;
  }> {
    const property = await this.properties.findOne({ where: { id: propertyId }, relations: ['community'] });
    if (!property) throw new NotFoundException('Property not found');

    let version: { versionId: number; masterId: number; periodStart: string; periodEnd: string; effectiveFrom: string; deprecatedOn: string | null; ageDays: number } | undefined;

    if (periodOverride) {
      // The caller already resolved the exact correct period (via
      // resolveVersionForReadingDate) — use it verbatim, never re-deriving "the period for this
      // version id" independently, which could silently diverge for a version that recurs monthly
      // while still current (see this method's own doc comment above).
      version = {
        versionId: cycleVersionId,
        masterId: periodOverride.masterId,
        periodStart: periodOverride.periodStart,
        periodEnd: periodOverride.periodEnd,
        effectiveFrom: '',
        deprecatedOn: null,
        ageDays: 0,
      };
    } else {
      const historicalVersions = await this.billingCycleService.getHistoricalVersionsForProperty(propertyId);
      version = historicalVersions.find((v) => v.versionId === cycleVersionId);
      // getHistoricalVersionsForProperty only ever lists DEPRECATED versions — but an explicit-id
      // caller (no periodOverride) can still legitimately name the property's CURRENTLY ACTIVE
      // version. Falling through to getReadingPeriodForProperty's own (today-anchored) period here
      // is correct ONLY for this explicit-id, no-override path — it deliberately does NOT apply when
      // periodOverride is given, since that's exactly the case where "today-anchored" would be
      // wrong (see doc comment above). This never changes what "valid" means for a genuinely wrong
      // id (still blocked below) — it only recognizes a real, currently-active version as valid,
      // exactly as getReadingPeriodForProperty itself already defines "current" to mean.
      if (!version) {
        const currentPeriod = await this.billingCycleService.getReadingPeriodForProperty(propertyId);
        if (currentPeriod && currentPeriod.versionId === cycleVersionId) {
          version = {
            versionId: currentPeriod.versionId,
            masterId: currentPeriod.masterId,
            periodStart: currentPeriod.periodStart,
            periodEnd: currentPeriod.periodEnd,
            effectiveFrom: '',
            deprecatedOn: null,
            ageDays: 0,
          };
        }
      }
    }
    if (!version) {
      // Never silently resolve a different version or fall back to some OTHER cycle — a genuinely
      // invalid/unresolvable id (neither a real deprecated version nor the real current one) is a
      // hard block, not a "closest match" substitution.
      return {
        propertyId: property.id,
        propertyName: property.name,
        propertyCode: property.businessCode ?? property.code ?? null,
        cycleVersionId,
        periodStart: '',
        periodEnd: '',
        ageDays: 0,
        eligibleForBilling: false,
        blockingReasons: ['Selected cycle version is not a valid historical or current version for this property'],
        missingReadingMeterIds: [],
        existingBillRun: null,
        units: [],
      };
    }

    const blockingReasons: string[] = [];

    const billableUnits = await this.units.find({
      where: { property: { id: property.id }, status: UnitStatus.ACTIVE },
    });
    const unitIds = billableUnits.map((u) => u.id);

    // ANY prior Bill Run for this exact (property, cycleVersionId) — regardless of status, and
    // regardless of whether it was ever flagged any particular way — is surfaced here so a user
    // checking a recovered reading can see whether this period was already billed through the
    // existing, single Bill Run mechanism. This is a read-only report for the recovery check; it
    // does not gate or enable any submission path of its own (there is no separate historical
    // submission flow — recovered readings are billed, if at all, through the existing routine Bill
    // Run process once operationally appropriate).
    const existingBillRun = await this.billRuns.findOne({
      where: { propertyId: property.id, cycleVersionId },
      order: { id: 'DESC' },
    });
    if (existingBillRun) {
      blockingReasons.push(
        `A bill run (${existingBillRun.businessCode ?? '#' + existingBillRun.id}) already exists for this property and cycle version — status: ${existingBillRun.status}`,
      );
    }

    const [subMeterByUnitId, readingCountByUnitId, tariffResults, customersByUnit] = await Promise.all([
      this.getMappedSubMetersByUnitId(unitIds),
      this.getReadingCountsByUnitId(unitIds, version.periodStart, version.periodEnd),
      this.tariffService.resolveForUnitsAsOf(unitIds, version.periodStart),
      this.customerService.findByUnitIds(unitIds),
    ]);

    // Minimum 2, not 1: BillingManagementService.calculateConsumption needs an OPENING and a
    // CLOSING reading inside the period to compute a diff — with exactly 1 reading in-window there
    // is nothing to diff against, and generation would throw "No qualifying meter reading found"
    // for that unit even though a naive presence check (>0) would have called it eligible. This is
    // exactly the gap a live check on Grand Tower A's Sep 27-30 period surfaced: every one of the
    // 24 units had exactly 1 reading in-window (1 genuine, 23 later confirmed to be synthetic test
    // data that should never have reached this table — see MIN_QUALIFYING_READINGS_PER_UNIT's own
    // note), so the OLD `>0` check reported `eligibleForBilling: true` for a period that would have
    // generated zero real Bills on approval. hasQualifyingReading/missingReadingMeterIds below now
    // mean "sufficient to compute consumption," not merely "a reading exists" — matching what
    // generation itself actually requires, never a looser, misleading definition of "ready."
    const MIN_QUALIFYING_READINGS_PER_UNIT = 2;

    const missingReadingMeterIds: string[] = [];
    const units = billableUnits.map((unit) => {
      const subMeter = subMeterByUnitId.get(unit.id);
      const readingCount = readingCountByUnitId.get(unit.id) ?? 0;
      const hasQualifyingReading = subMeter ? readingCount >= MIN_QUALIFYING_READINGS_PER_UNIT : false;
      if (!hasQualifyingReading && subMeter) {
        // Distinguishes "no reading at all" from "exactly one reading, no opening value to diff
        // against" — both block, but for a genuinely different reason a user should see explicitly
        // rather than a single undifferentiated "missing" label.
        const suffix = readingCount === 1 ? ' (only 1 reading in this period — no opening reading to compute consumption)' : '';
        missingReadingMeterIds.push((subMeter.businessCode ?? `unit-${unit.id}`) + suffix);
      } else if (!subMeter) missingReadingMeterIds.push(`unit-${unit.id} (no meter mapped)`);

      const tariffResult = tariffResults.get(unit.id);
      const tariffStatus: 'resolved' | 'no_match' | 'ambiguous' =
        tariffResult === 'ambiguous' ? 'ambiguous' : tariffResult ? 'resolved' : 'no_match';

      const unitCustomers = customersByUnit.get(unit.id) ?? [];
      const { currentCustomer } = this.customerService.resolveCurrentCustomer(unitCustomers);

      return {
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        hasQualifyingReading,
        meterBusinessCode: subMeter?.businessCode ?? null,
        tariffStatus,
        tariffVersionId: tariffResult && tariffResult !== 'ambiguous' ? tariffResult.id : null,
        resolvedCustomer: currentCustomer
          ? { id: currentCustomer.id, businessCode: currentCustomer.businessCode, fullName: currentCustomer.fullName }
          : null,
        // Always true for every unit in this preview — NOT a per-unit computed flag. The schema has
        // no point-in-time occupancy history (see the design audit's own finding): resolvedCustomer
        // above is always "whoever occupies this unit RIGHT NOW," never verified against who
        // actually occupied it during the historical period. Attestation is required unconditionally,
        // not selectively, so this can never be misread as "most units are already verified."
        occupantVerificationRequired: true,
      };
    });

    if (missingReadingMeterIds.length > 0) {
      blockingReasons.push(
        `${missingReadingMeterIds.length} of ${unitIds.length} required meter(s) do not have enough readings in this period to compute consumption (at least ${MIN_QUALIFYING_READINGS_PER_UNIT} needed — an opening and a closing reading) — never assumed to be zero consumption`,
      );
    }

    const unitsWithTariffIssue = units.filter((u) => u.tariffStatus !== 'resolved');
    if (unitsWithTariffIssue.length > 0) {
      const ambiguous = unitsWithTariffIssue.filter((u) => u.tariffStatus === 'ambiguous').length;
      const noMatch = unitsWithTariffIssue.filter((u) => u.tariffStatus === 'no_match').length;
      blockingReasons.push(
        `Tariff as of ${version.periodStart} could not be unambiguously resolved for ${unitsWithTariffIssue.length} unit(s) (${noMatch} no match, ${ambiguous} ambiguous/overlapping) — never falls back to today's active tariff`,
      );
    }

    return {
      propertyId: property.id,
      propertyName: property.name,
      propertyCode: property.businessCode ?? property.code ?? null,
      cycleVersionId,
      periodStart: version.periodStart,
      periodEnd: version.periodEnd,
      ageDays: version.ageDays,
      eligibleForBilling: blockingReasons.length === 0,
      blockingReasons,
      missingReadingMeterIds,
      existingBillRun: existingBillRun
        ? { id: existingBillRun.id, businessCode: existingBillRun.businessCode ?? null, status: existingBillRun.status }
        : null,
      units,
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

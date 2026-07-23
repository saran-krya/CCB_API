import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { AttributeService } from '../attribute/attribute.service';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { User } from '../user/entities/user.entity';
import {
  CreateMasterMeterDto,
  CreateSubMeterDto,
  MeterCommunitiesOverviewQueryDto,
  MeterPropertiesOverviewQueryDto,
  MeterUnitsOverviewQueryDto,
  MeterQueryDto,
  SetMeterStatusDto,
  UpdateMasterMeterDto,
  UpdateSubMeterDto,
} from './dto/meter.dto';
import { MasterMeter } from './entities/master-meter.entity';
import { MeterImportType } from './entities/meter-import-type.enum';
import { MeterStatus } from './entities/meter-status.enum';
import { SubMeter } from './entities/sub-meter.entity';
import { ImportFailedRecord, ImportFailureReason, ImportSummary } from './entities/import-result.types';

// Import/export column mapping — sourced entirely from the Attributes module
// (MASTER_METER_IMPORT_COLUMNS / SUB_METER_IMPORT_COLUMNS), never hardcoded
// here. Adding, removing, reordering, or disabling a column is a config
// change in System Admin → Attributes, not a code change.
interface ColumnConfig {
  internalField: string;
  displayLabel: string;
  mandatory: boolean;
  locked: boolean;
  enabled: boolean;
}

const MASTER_METER_COLUMNS_KEY = 'MASTER_METER_IMPORT_COLUMNS';
const SUB_METER_COLUMNS_KEY = 'SUB_METER_IMPORT_COLUMNS';

// Matches the `business_code varchar(20)` column on both master_meters and
// sub_meters — enforced pre-commit so a too-long uploaded ID fails as a
// clean per-row validation message instead of a raw DB error aborting the
// whole batch.
const BUSINESS_CODE_MAX_LENGTH = 20;
const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const FREE_TEXT_MAX_LENGTH = 100; // matches meterMake/meterModel column length

// The MIME type a browser/OS actually attaches to a .xlsx file varies by
// platform — the official OOXML type plus two legacy/generic types seen in
// practice (some Windows configurations and older browsers send
// application/octet-stream for any unrecognized-by-the-OS extension).
// Checked only when the client sent a mimetype at all (some HTTP clients
// omit it) — see the runImport call site for why this can never be the
// sole gate against a malicious upload.
const ACCEPTED_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
]);

type ImportRow = Record<string, any>;

// Resolves an internalField key back to its configured Excel Column Header
// for a duplicate-value error message — falls back to the raw field name if
// the column somehow isn't in the current config (defensive only).
function columnLabel(columns: ColumnConfig[], internalField: string): string {
  return columns.find((c) => c.internalField === internalField)?.displayLabel ?? internalField;
}

// Excel/Sheets treats a cell whose text begins with =, +, -, or @ as a
// formula — the Error Report echoes back the original cell values from the
// user's own uploaded file verbatim (so they can be fixed and re-uploaded),
// which means an untrusted value from that file would otherwise be written
// into a brand-new .xlsx as a LIVE formula, executing if anyone opens the
// generated report in Excel (the well-known CSV/Excel formula-injection
// class). Prefixing with a leading apostrophe is the standard mitigation —
// Excel displays the value as literal text instead of evaluating it.
function sanitizeForExcel(value: string | null): string | null {
  if (value === null) return null;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

// Excel stores dates as either a native Date (when the cell is date-
// formatted) or a serial day-count number (when it isn't) — both are valid
// user input for an "Installation Date" column, so both are accepted and
// normalized to an ISO yyyy-mm-dd string the `date`-type DB column accepts.
// Anything else (a stray string like "next Monday") is rejected as invalid
// rather than passed through and left to fail opaquely at the DB layer.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
function parseExcelDateCell(cellValue: unknown): { ok: true; value: string | null } | { ok: false } {
  if (cellValue === null || cellValue === undefined || cellValue === '') return { ok: true, value: null };
  if (cellValue instanceof Date) {
    if (Number.isNaN(cellValue.getTime())) return { ok: false };
    return { ok: true, value: cellValue.toISOString().slice(0, 10) };
  }
  if (typeof cellValue === 'number') {
    const ms = EXCEL_EPOCH_MS + cellValue * 86400000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return { ok: false };
    return { ok: true, value: date.toISOString().slice(0, 10) };
  }
  if (typeof cellValue === 'string') {
    const trimmed = cellValue.trim();
    if (!trimmed) return { ok: true, value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false };
    const date = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return { ok: false };
    return { ok: true, value: trimmed };
  }
  return { ok: false };
}

function generateBatchId(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `IMP-${stamp}-${random}`;
}

@Injectable()
export class MeterService {
  constructor(
    @InjectRepository(MasterMeter) private readonly masterMeters: Repository<MasterMeter>,
    @InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>,
    @InjectRepository(Community) private readonly communities: Repository<Community>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(Unit) private readonly units: Repository<Unit>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly attributeService: AttributeService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Stats / dashboard (Meter Information rollup) ──────────────────────────

  async getStats() {
    const [totalCommunities, totalProperties, totalUnits, totalMasterMeters, totalSubMeters] = await Promise.all([
      this.communities.count(),
      this.properties.count(),
      this.units.count(),
      this.masterMeters.count(),
      this.subMeters.count(),
    ]);
    // Coverage, not a meter tally: "Mapped" answers "how many Properties /
    // Units have been assigned a meter", so the denominator is the parent
    // entity count (Properties / Units), never the meter row count. A
    // Property could in principle carry more than one Master Meter (no DB
    // constraint forbids it), so this is COUNT(DISTINCT property_id), not
    // COUNT(*) — one property with 2 master meters still counts as 1
    // covered property. Sub Meter coverage mirrors this over Units; the
    // DISTINCT is redundant there in practice (sub_meters.unit_id already
    // carries a unique constraint — see MeterUniquenessMigrationService) but
    // kept for the same defensive reason and symmetry with the Master Meter query.
    const [mappedMasterMeters, mappedSubMeters] = await Promise.all([
      this.masterMeters.createQueryBuilder('m').select('COUNT(DISTINCT m.property_id)', 'cnt').getRawOne<{ cnt: string }>(),
      this.subMeters.createQueryBuilder('s').where('s.unit_id IS NOT NULL').select('COUNT(DISTINCT s.unit_id)', 'cnt').getRawOne<{ cnt: string }>(),
    ]);
    const mappedMasterMetersCount = Number(mappedMasterMeters?.cnt ?? 0);
    const mappedSubMetersCount = Number(mappedSubMeters?.cnt ?? 0);
    return {
      totalCommunities,
      totalProperties,
      totalUnits,
      totalMasterMeters,
      totalSubMeters,
      mappedMasterMeters: mappedMasterMetersCount,
      unmappedMasterMeters: totalProperties - mappedMasterMetersCount,
      mappedMeters: mappedSubMetersCount,
      unmappedMeters: totalUnits - mappedSubMetersCount,
    };
  }

  // Sortable columns are limited to real base-table columns (name, status) —
  // every coverage/count field is computed via separate grouped queries
  // scoped to this page's community IDs, not part of the base `communities`
  // table, so there's nothing meaningful to ORDER BY for those.
  private static readonly COMMUNITIES_OVERVIEW_SORTABLE = new Set(['name', 'status']);

  async getCommunitiesOverview(query: MeterCommunitiesOverviewQueryDto = new MeterCommunitiesOverviewQueryDto()) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const sortBy = MeterService.COMMUNITIES_OVERVIEW_SORTABLE.has(query.sortBy ?? '') ? query.sortBy! : 'name';
    const sortOrder = query.sortOrder ?? 'ASC';

    const qb = this.communities.createQueryBuilder('c').orderBy(`c.${sortBy}`, sortOrder);
    if (query.search) qb.andWhere('c.name LIKE :s', { s: `%${query.search}%` });
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });

    const [communities, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const pagination = { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
    if (communities.length === 0) return { items: [], pagination };

    const communityIds = communities.map((c) => c.id);
    const toMap = (rows: Array<{ communityId: string; count: string }>) =>
      new Map(rows.map((r) => [Number(r.communityId), Number(r.count)]));

    const [unitRows, propertyRows, masterRows, subRows, mappedSubRows, mappedMasterRows] = await Promise.all([
      this.units.createQueryBuilder('u').innerJoin('u.property', 'p').where('p.community_id IN (:...ids)', { ids: communityIds }).select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      this.properties.createQueryBuilder('p').where('p.community_id IN (:...ids)', { ids: communityIds }).select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      this.masterMeters.createQueryBuilder('m').innerJoin('m.property', 'p').where('p.community_id IN (:...ids)', { ids: communityIds }).select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      this.subMeters.createQueryBuilder('s').innerJoin('s.property', 'p').where('p.community_id IN (:...ids)', { ids: communityIds }).select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      // Coverage, not a meter tally — see getStats()'s comment for why this
      // is COUNT(DISTINCT ...) over the parent entity (Units here), not
      // COUNT(*) over the meter rows.
      this.subMeters.createQueryBuilder('s').innerJoin('s.property', 'p').where('p.community_id IN (:...ids)', { ids: communityIds }).andWhere('s.unit_id IS NOT NULL').select('p.community_id', 'communityId').addSelect('COUNT(DISTINCT s.unit_id)', 'count').groupBy('p.community_id').getRawMany(),
      this.masterMeters.createQueryBuilder('m').innerJoin('m.property', 'p').where('p.community_id IN (:...ids)', { ids: communityIds }).select('p.community_id', 'communityId').addSelect('COUNT(DISTINCT m.property_id)', 'count').groupBy('p.community_id').getRawMany(),
    ]);
    const unitsMap = toMap(unitRows), propsMap = toMap(propertyRows), mmMap = toMap(masterRows), smMap = toMap(subRows);
    const mappedSubMap = toMap(mappedSubRows), mappedMasterMap = toMap(mappedMasterRows);

    const items = communities.map((c) => {
      const totalUnits = unitsMap.get(c.id) ?? 0;
      const totalProperties = propsMap.get(c.id) ?? 0;
      const mappedMeters = mappedSubMap.get(c.id) ?? 0;
      const mappedMasterMeters = mappedMasterMap.get(c.id) ?? 0;
      return {
        id: c.id,
        code: c.businessCode ?? c.code,
        name: c.name,
        totalProperties,
        totalUnits,
        totalMasterMeters: mmMap.get(c.id) ?? 0,
        totalSubMeters: smMap.get(c.id) ?? 0,
        mappedMasterMeters,
        unmappedMasterMeters: totalProperties - mappedMasterMeters,
        mappedMeters,
        unmappedMeters: totalUnits - mappedMeters,
        status: c.status,
      };
    });

    return { items, pagination };
  }

  async getCommunityDetail(communityId: number) {
    const community = await this.communities.findOne({ where: { id: communityId } });
    if (!community) throw new NotFoundException('Community not found');

    // Single-community summary — same shape/queries as getCommunitiesOverview(),
    // just scoped to this one ID instead of a paginated page of communities.
    const [totalUnits, totalProperties, totalMasterMeters, totalSubMeters, mappedMeters, mappedMasterMeters] = await Promise.all([
      this.units.createQueryBuilder('u').innerJoin('u.property', 'p').where('p.community_id = :communityId', { communityId }).getCount(),
      this.properties.count({ where: { community: { id: communityId } } }),
      this.masterMeters.createQueryBuilder('m').innerJoin('m.property', 'p').where('p.community_id = :communityId', { communityId }).getCount(),
      this.subMeters.createQueryBuilder('s').innerJoin('s.property', 'p').where('p.community_id = :communityId', { communityId }).getCount(),
      this.subMeters.createQueryBuilder('s').innerJoin('s.property', 'p').where('p.community_id = :communityId', { communityId }).andWhere('s.unit_id IS NOT NULL').select('COUNT(DISTINCT s.unit_id)', 'cnt').getRawOne<{ cnt: string }>().then((r) => Number(r?.cnt ?? 0)),
      this.masterMeters.createQueryBuilder('m').innerJoin('m.property', 'p').where('p.community_id = :communityId', { communityId }).select('COUNT(DISTINCT m.property_id)', 'cnt').getRawOne<{ cnt: string }>().then((r) => Number(r?.cnt ?? 0)),
    ]);

    const summary = {
      id: community.id,
      code: community.businessCode ?? community.code,
      name: community.name,
      totalProperties,
      totalUnits,
      totalMasterMeters,
      totalSubMeters,
      mappedMasterMeters,
      unmappedMasterMeters: totalProperties - mappedMasterMeters,
      mappedMeters,
      unmappedMeters: totalUnits - mappedMeters,
      status: community.status,
    };

    return { community: { id: community.id, name: community.name, code: community.businessCode ?? community.code, status: community.status }, summary };
  }

  // Sortable columns limited to real base-table columns (name, status) — see
  // COMMUNITIES_OVERVIEW_SORTABLE's comment for why the coverage/count
  // fields aren't included.
  private static readonly PROPERTIES_OVERVIEW_SORTABLE = new Set(['name', 'status']);

  async getPropertiesOverview(communityId: number, query: MeterPropertiesOverviewQueryDto = new MeterPropertiesOverviewQueryDto()) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const sortBy = MeterService.PROPERTIES_OVERVIEW_SORTABLE.has(query.sortBy ?? '') ? query.sortBy! : 'name';
    const sortOrder = query.sortOrder ?? 'ASC';

    const qb = this.properties.createQueryBuilder('p').where('p.community_id = :communityId', { communityId }).orderBy(`p.${sortBy}`, sortOrder);
    if (query.search) qb.andWhere('p.name LIKE :s', { s: `%${query.search}%` });
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });

    const [properties, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const pagination = { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
    if (properties.length === 0) return { items: [], pagination };

    const propertyIds = properties.map((p) => p.id);
    const toMap = (rows: Array<{ propertyId: string; count: string }>) =>
      new Map(rows.map((r) => [Number(r.propertyId), Number(r.count)]));

    const [unitRows, masterRows, subRows, mappedRows] = await Promise.all([
      this.units.createQueryBuilder('u').where('u.property_id IN (:...ids)', { ids: propertyIds }).select('u.property_id', 'propertyId').addSelect('COUNT(*)', 'count').groupBy('u.property_id').getRawMany(),
      this.masterMeters.createQueryBuilder('m').where('m.property_id IN (:...ids)', { ids: propertyIds }).select('m.property_id', 'propertyId').addSelect('COUNT(*)', 'count').groupBy('m.property_id').getRawMany(),
      this.subMeters.createQueryBuilder('s').where('s.property_id IN (:...ids)', { ids: propertyIds }).select('s.property_id', 'propertyId').addSelect('COUNT(*)', 'count').groupBy('s.property_id').getRawMany(),
      // Coverage, not a meter tally — see getStats()'s comment for why this
      // is COUNT(DISTINCT unit_id) over Units, not COUNT(*) over Sub Meters.
      this.subMeters.createQueryBuilder('s').where('s.property_id IN (:...ids)', { ids: propertyIds }).andWhere('s.unit_id IS NOT NULL').select('s.property_id', 'propertyId').addSelect('COUNT(DISTINCT s.unit_id)', 'count').groupBy('s.property_id').getRawMany(),
    ]);
    const unitsMap = toMap(unitRows), mmMap = toMap(masterRows), smMap = toMap(subRows), mappedMap = toMap(mappedRows);

    const items = properties.map((p) => {
      const totalUnits = unitsMap.get(p.id) ?? 0;
      const mappedMeters = mappedMap.get(p.id) ?? 0;
      return {
        id: p.id,
        code: p.businessCode ?? p.code,
        name: p.name,
        totalUnits,
        totalMasterMeters: mmMap.get(p.id) ?? 0,
        // A property has at most a small handful of master meters in
        // practice — coverage at this level is a yes/no fact, not a count,
        // so callers show a single "Has Master Meter" badge rather than a
        // mapped/unmapped pair.
        hasMasterMeter: (mmMap.get(p.id) ?? 0) > 0,
        totalSubMeters: smMap.get(p.id) ?? 0,
        mappedMeters,
        unmappedMeters: totalUnits - mappedMeters,
        status: p.status,
      };
    });

    return { items, pagination };
  }

  async getPropertyDetail(propertyId: number) {
    const property = await this.properties.findOne({ where: { id: propertyId }, relations: ['community'] });
    if (!property) throw new NotFoundException('Property not found');

    const [units, masterMeter, subMeters] = await Promise.all([
      this.units.find({ where: { property: { id: propertyId } }, order: { unitNumber: 'ASC' } }),
      this.masterMeters.findOne({ where: { property: { id: propertyId } }, relations: ['property', 'property.community'], order: { id: 'ASC' } }),
      this.subMeters.find({ where: { property: { id: propertyId } }, relations: ['unit', 'masterMeter'] }),
    ]);

    const subMeterByUnitId = new Map(subMeters.filter((s) => s.unit).map((s) => [s.unit!.id, s]));
    const mappedSubMeters = subMeters.filter((s) => s.unit).length;

    return {
      property: {
        id: property.id,
        code: property.businessCode ?? property.code,
        name: property.name,
        status: property.status,
        communityName: property.community?.name ?? null,
      },
      masterMeter: masterMeter ? this.mapMasterMeterResponse(masterMeter) : null,
      stats: {
        totalUnits: units.length,
        mappedSubMeters,
        // Coverage over Units, not a meter tally — a Unit that has no Sub
        // Meter is unmapped even if this property's Sub Meter count happens
        // to differ from its Unit count (e.g. 3 sub meters against 180
        // units means 177 units unmapped, not "0 sub meters left over").
        unmappedSubMeters: units.length - mappedSubMeters,
        occupiedUnits: units.filter((u) => u.occupancyStatus === 'occupied').length,
        vacantUnits: units.filter((u) => u.occupancyStatus === 'vacant').length,
      },
      units: units.map((u) => ({
        id: u.id,
        code: u.businessCode,
        unitNumber: u.unitNumber,
        floorNumber: u.floorNumber,
        unitType: u.unitType,
        unitSize: u.unitSize,
        occupancyStatus: u.occupancyStatus,
        status: u.status,
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        balcony: u.balcony,
        parkingSpaces: u.parkingSpaces,
        monthlyRent: u.monthlyRent,
        handoverDate: u.handoverDate,
        ownerId: u.ownerId,
        tenantId: u.tenantId,
        amenities: u.amenities,
        description: u.description,
        subMeter: subMeterByUnitId.has(u.id) ? this.mapSubMeterResponse(subMeterByUnitId.get(u.id)!) : null,
      })),
    };
  }

  // Sortable columns limited to real base-table columns on `units` — see
  // COMMUNITIES_OVERVIEW_SORTABLE's comment for why the meter-mapping fields
  // (computed via a join, not part of this table) aren't included.
  private static readonly UNITS_OVERVIEW_SORTABLE = new Set(['unitNumber', 'status']);

  async getUnitsOverview(propertyId: number, query: MeterUnitsOverviewQueryDto = new MeterUnitsOverviewQueryDto()) {
    const property = await this.properties.findOne({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const sortBy = MeterService.UNITS_OVERVIEW_SORTABLE.has(query.sortBy ?? '') ? query.sortBy! : 'unitNumber';
    const sortOrder = query.sortOrder ?? 'ASC';

    const qb = this.units
      .createQueryBuilder('u')
      .where('u.property_id = :propertyId', { propertyId })
      .orderBy(`u.${sortBy === 'unitNumber' ? 'unit_number' : sortBy}`, sortOrder);
    if (query.search) qb.andWhere('u.unit_number LIKE :s', { s: `%${query.search}%` });
    if (query.status) qb.andWhere('u.unit_status = :status', { status: query.status });

    const [units, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const pagination = { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
    if (units.length === 0) return { items: [], pagination };

    const unitIds = units.map((u) => u.id);
    const [masterMeter, subMeters] = await Promise.all([
      this.masterMeters.findOne({ where: { property: { id: propertyId } }, order: { id: 'ASC' } }),
      this.subMeters.find({ where: { unit: { id: In(unitIds) } }, relations: ['unit'] }),
    ]);
    const subMeterByUnitId = new Map(subMeters.filter((s) => s.unit).map((s) => [s.unit!.id, s]));

    const items = units.map((u) => {
      const subMeter = subMeterByUnitId.get(u.id) ?? null;
      return {
        id: u.id,
        unitNumber: u.unitNumber,
        floorNumber: u.floorNumber,
        hasMasterMeter: !!masterMeter,
        masterMeterCode: masterMeter?.businessCode ?? null,
        hasSubMeter: !!subMeter,
        subMeterCode: subMeter?.businessCode ?? null,
        status: u.status,
      };
    });

    return { items, pagination };
  }

  // ─── Meter Inventory filter metadata ────────────────────────────────────────

  // Single shared metadata call for both the Master Meter and Sub Meter
  // inventory tabs — they filter on the exact same three dimensions
  // (community/property/status), so one method backs both
  // 'master-meters/metaFilters' and 'sub-meters/metaFilters' routes, matching
  // the "one metaFilters call feeds every filter dropdown" convention already
  // established by BillingCycleService.getFilterMetadata().
  async getMeterInventoryFilterMetadata() {
    const [communities, properties] = await Promise.all([
      this.communities.find({ select: ['id', 'name'], order: { name: 'ASC' } }),
      this.properties.find({ select: ['id', 'name'], relations: ['community'], order: { name: 'ASC' } }),
    ]);

    return {
      communities: communities.map((c) => ({ id: c.id, name: c.name })),
      properties: properties.map((p) => ({ id: p.id, name: p.name, communityId: p.community?.id ?? null })),
      statuses: [
        { value: MeterStatus.ACTIVE, label: 'Active' },
        { value: MeterStatus.INACTIVE, label: 'Inactive' },
      ],
    };
  }

  // ─── Master Meter CRUD ──────────────────────────────────────────────────────

  // Maps each sortable response field to its real alias-prefixed ORM path —
  // propertyName/communityName live on the joined Property/Community aliases,
  // not a column directly on MasterMeter, so a plain `m.${sortBy}` template
  // (as COMMUNITIES_OVERVIEW_SORTABLE uses for same-table columns) can't
  // express this; every other field maps back onto the base 'm' alias. Same
  // camelCase-ORM-property-name requirement as every other orderBy() in this
  // codebase — passing a raw DB column name here fails deep inside TypeORM's
  // combined-order-by resolution rather than with a clear error (see
  // SftpFileListService's SORTABLE_COLUMNS for the exact same gotcha).
  private static readonly MASTER_METERS_SORTABLE: Record<string, string> = {
    code: 'm.businessCode',
    serialNumber: 'm.serialNumber',
    dtuId: 'm.dtuId',
    propertyName: 'property.name',
    communityName: 'community.name',
    status: 'm.status',
    installationDate: 'm.installationDate',
    createdAt: 'm.createdAt',
  };

  async findMasterMeters(query: MeterQueryDto) {
    const qb = this.masterMeters
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.property', 'property')
      .leftJoinAndSelect('property.community', 'community');
    if (query.propertyId) qb.andWhere('property.id = :propertyId', { propertyId: query.propertyId });
    if (query.communityId) qb.andWhere('community.id = :communityId', { communityId: query.communityId });
    if (query.status) qb.andWhere('m.status = :status', { status: query.status });
    if (query.search) {
      qb.andWhere('(m.business_code LIKE :s OR m.serial_number LIKE :s OR m.dtu_id LIKE :s)', { s: `%${query.search}%` });
    }
    const orderCol = MeterService.MASTER_METERS_SORTABLE[query.sortBy ?? ''] ?? 'm.id';
    qb.orderBy(orderCol, query.sortOrder === 'ASC' ? 'ASC' : 'DESC');
    const result = await paginate(qb, query);
    return { ...result, items: result.items.map((m) => this.mapMasterMeterResponse(m)) };
  }

  async findOneMasterMeter(id: number) {
    const meter = await this.masterMeters.findOne({ where: { id }, relations: ['property', 'property.community'] });
    if (!meter) throw new NotFoundException('Master meter not found');
    return this.mapMasterMeterResponse(meter);
  }

  async createMasterMeter(dto: CreateMasterMeterDto, actorId?: number) {
    const property = await this.properties.findOne({ where: { id: dto.propertyId } });
    if (!property) throw new BadRequestException(`Property ${dto.propertyId} not found`);

    const entity = this.masterMeters.create({
      serialNumber: dto.serialNumber ?? null,
      dtuId: dto.dtuId ?? null,
      property,
      mBusAddress: dto.mBusAddress ?? null,
      meterMake: dto.meterMake ?? null,
      meterModel: dto.meterModel ?? null,
      installationDate: dto.installationDate ?? null,
    });
    if (actorId) {
      entity.createdByUser = { id: actorId } as any;
      entity.lastModifiedByUser = { id: actorId } as any;
    }

    // UQ_master_meters_property_id (one Master Meter per Property),
    // UQ_master_meters_serial_number, UQ_master_meters_dtu_id, and
    // UQ_master_meters_property_mbus are all real DB constraints (see
    // MeterUniquenessMigrationService) that this single-record create path
    // has no pre-check for — unlike bulk import, which validates against a
    // snapshot first (see propertiesWithMasterMeter in runImport()). A
    // collision here is rarer (no concurrent-batch race) but just as real —
    // e.g. two admins creating a Master Meter for the same Property at
    // nearly the same time — so it gets the same clean-message treatment
    // toCommitFailure() already gives the import path, instead of a raw
    // MySQL 500.
    let saved: MasterMeter;
    try {
      saved = await this.masterMeters.save(entity);
    } catch (err) {
      throw this.toDuplicateKeyException(err);
    }
    saved.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.MASTER_METER, saved.id);
    await this.masterMeters.update(saved.id, { businessCode: saved.businessCode });

    await this.auditService.record({ moduleName: 'Meter', entityId: saved.id, action: 'CREATE', oldValue: null, newValue: saved, performedBy: actorId });
    return this.findOneMasterMeter(saved.id);
  }

  async updateMasterMeter(id: number, dto: UpdateMasterMeterDto, actorId?: number) {
    const meter = await this.masterMeters.findOne({ where: { id } });
    if (!meter) throw new NotFoundException('Master meter not found');
    const oldValue = { ...meter };
    Object.assign(meter, dto);
    if (actorId) meter.lastModifiedByUser = { id: actorId } as any;
    const saved = await this.masterMeters.save(meter);
    await this.auditService.record({ moduleName: 'Meter', entityId: id, action: 'UPDATE', oldValue, newValue: saved, performedBy: actorId });
    return this.findOneMasterMeter(id);
  }

  async setMasterMeterStatus(id: number, dto: SetMeterStatusDto, actorId?: number) {
    const meter = await this.masterMeters.findOne({ where: { id } });
    if (!meter) throw new NotFoundException('Master meter not found');
    const oldValue = { status: meter.status };
    meter.status = dto.status;
    if (actorId) meter.lastModifiedByUser = { id: actorId } as any;
    const saved = await this.masterMeters.save(meter);
    await this.auditService.record({
      moduleName: 'Meter',
      entityId: id,
      action: dto.status === MeterStatus.ACTIVE ? 'ACTIVATE' : 'DEACTIVATE',
      oldValue,
      newValue: { status: saved.status },
      performedBy: actorId,
    });
    return this.findOneMasterMeter(id);
  }

  // ─── Sub Meter CRUD ─────────────────────────────────────────────────────────

  // Same rationale as MASTER_METERS_SORTABLE above — propertyName/
  // communityName/unitNumber/masterMeterCode all live on joined aliases, not
  // directly on SubMeter.
  private static readonly SUB_METERS_SORTABLE: Record<string, string> = {
    code: 's.businessCode',
    serialNumber: 's.serialNumber',
    masterMeterCode: 'masterMeter.businessCode',
    propertyName: 'property.name',
    communityName: 'community.name',
    unitNumber: 'unit.unitNumber',
    status: 's.status',
    installationDate: 's.installationDate',
    createdAt: 's.createdAt',
  };

  async findSubMeters(query: MeterQueryDto) {
    const qb = this.subMeters
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.property', 'property')
      .leftJoinAndSelect('property.community', 'community')
      .leftJoinAndSelect('s.unit', 'unit')
      .leftJoinAndSelect('s.masterMeter', 'masterMeter');
    if (query.propertyId) qb.andWhere('property.id = :propertyId', { propertyId: query.propertyId });
    if (query.communityId) qb.andWhere('community.id = :communityId', { communityId: query.communityId });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    if (query.search) {
      qb.andWhere('(s.business_code LIKE :s OR s.serial_number LIKE :s)', { s: `%${query.search}%` });
    }
    const orderCol = MeterService.SUB_METERS_SORTABLE[query.sortBy ?? ''] ?? 's.id';
    qb.orderBy(orderCol, query.sortOrder === 'ASC' ? 'ASC' : 'DESC');
    const result = await paginate(qb, query);
    return { ...result, items: result.items.map((s) => this.mapSubMeterResponse(s)) };
  }

  async findOneSubMeter(id: number) {
    const meter = await this.subMeters.findOne({ where: { id }, relations: ['property', 'property.community', 'unit', 'masterMeter'] });
    if (!meter) throw new NotFoundException('Sub meter not found');
    return this.mapSubMeterResponse(meter);
  }

  async createSubMeter(dto: CreateSubMeterDto, actorId?: number) {
    const [property, masterMeter, unit] = await Promise.all([
      this.properties.findOne({ where: { id: dto.propertyId } }),
      this.masterMeters.findOne({ where: { id: dto.masterMeterId } }),
      dto.unitId ? this.units.findOne({ where: { id: dto.unitId } }) : Promise.resolve(null),
    ]);
    if (!property) throw new BadRequestException(`Property ${dto.propertyId} not found`);
    if (!masterMeter) throw new BadRequestException(`Master meter ${dto.masterMeterId} not found`);
    if (dto.unitId && !unit) throw new BadRequestException(`Unit ${dto.unitId} not found`);

    const entity = this.subMeters.create({
      serialNumber: dto.serialNumber ?? null,
      masterMeter,
      property,
      unit: unit ?? null,
      mBusAddress: dto.mBusAddress ?? null,
      floor: dto.floor ?? null,
      meterMake: dto.meterMake ?? null,
      meterModel: dto.meterModel ?? null,
      installationDate: dto.installationDate ?? null,
      customerAccountNumber: dto.customerAccountNumber ?? null,
    });
    if (actorId) {
      entity.createdByUser = { id: actorId } as any;
      entity.lastModifiedByUser = { id: actorId } as any;
    }
    const saved = await this.subMeters.save(entity);
    saved.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.SUB_METER, saved.id);
    await this.subMeters.update(saved.id, { businessCode: saved.businessCode });

    await this.auditService.record({ moduleName: 'Meter', entityId: saved.id, action: 'CREATE', oldValue: null, newValue: saved, performedBy: actorId });
    return this.findOneSubMeter(saved.id);
  }

  async updateSubMeter(id: number, dto: UpdateSubMeterDto, actorId?: number) {
    const meter = await this.subMeters.findOne({ where: { id }, relations: ['unit', 'masterMeter'] });
    if (!meter) throw new NotFoundException('Sub meter not found');
    const oldValue = { ...meter };

    if (dto.unitId !== undefined) {
      if (dto.unitId === null) {
        meter.unit = null;
      } else {
        const unit = await this.units.findOne({ where: { id: dto.unitId } });
        if (!unit) throw new BadRequestException(`Unit ${dto.unitId} not found`);
        meter.unit = unit;
      }
    }
    if (dto.serialNumber !== undefined) meter.serialNumber = dto.serialNumber;
    if (dto.mBusAddress !== undefined) meter.mBusAddress = dto.mBusAddress;
    if (dto.floor !== undefined) meter.floor = dto.floor;
    if (dto.meterMake !== undefined) meter.meterMake = dto.meterMake;
    if (dto.meterModel !== undefined) meter.meterModel = dto.meterModel;
    if (dto.installationDate !== undefined) meter.installationDate = dto.installationDate;
    if (dto.customerAccountNumber !== undefined) meter.customerAccountNumber = dto.customerAccountNumber;
    if (actorId) meter.lastModifiedByUser = { id: actorId } as any;

    const saved = await this.subMeters.save(meter);

    await this.auditService.record({ moduleName: 'Meter', entityId: id, action: 'UPDATE', oldValue, newValue: saved, performedBy: actorId });
    return this.findOneSubMeter(id);
  }

  async setSubMeterStatus(id: number, dto: SetMeterStatusDto, actorId?: number) {
    const meter = await this.subMeters.findOne({ where: { id } });
    if (!meter) throw new NotFoundException('Sub meter not found');
    const oldValue = { status: meter.status };
    meter.status = dto.status;
    if (actorId) meter.lastModifiedByUser = { id: actorId } as any;
    const saved = await this.subMeters.save(meter);
    await this.auditService.record({
      moduleName: 'Meter',
      entityId: id,
      action: dto.status === MeterStatus.ACTIVE ? 'ACTIVATE' : 'DEACTIVATE',
      oldValue,
      newValue: { status: saved.status },
      performedBy: actorId,
    });
    return this.findOneSubMeter(id);
  }

  // ─── Column config (Attribute-driven) ───────────────────────────────────────

  private async getColumns(meterType: MeterImportType): Promise<ColumnConfig[]> {
    const key = meterType === MeterImportType.MASTER ? MASTER_METER_COLUMNS_KEY : SUB_METER_COLUMNS_KEY;
    return this.attributeService.getJsonValueByKey<ColumnConfig>(key);
  }

  // ─── Download template ──────────────────────────────────────────────────────

  async getImportTemplate(meterType: MeterImportType): Promise<Buffer> {
    const columns = (await this.getColumns(meterType)).filter((c) => c.enabled);
    if (columns.length === 0) throw new BadRequestException('No import columns are configured for this meter type');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(meterType === MeterImportType.MASTER ? 'Master Meters' : 'Sub Meters');
    sheet.columns = columns.map((c) => ({ header: c.displayLabel, key: c.internalField, width: 24 }));
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  async exportMeters(meterType: MeterImportType, query: MeterQueryDto): Promise<Buffer> {
    const columns = (await this.getColumns(meterType)).filter((c) => c.enabled);
    if (columns.length === 0) throw new BadRequestException('No export columns are configured for this meter type');

    const rows =
      meterType === MeterImportType.MASTER ? await this.buildMasterMeterExportRows(query) : await this.buildSubMeterExportRows(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(meterType === MeterImportType.MASTER ? 'Master Meters' : 'Sub Meters');
    sheet.columns = columns.map((c) => ({ header: c.displayLabel, key: c.internalField, width: 24 }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(rows);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // `ids` is used only by buildImportSuccessReport (the "Download Successful
  // Records" report after an import) — narrows to exactly the rows just
  // created instead of the caller's list filters, reusing this same
  // row-mapping shape rather than a second copy of it. `query` is typed to
  // only the 3 filter fields these builders actually read (not the full
  // MeterQueryDto, which also requires pagination fields) so a caller with
  // no list filters — like buildImportSuccessReport — can pass `{}`.
  private async buildMasterMeterExportRows(query: Pick<MeterQueryDto, 'propertyId' | 'communityId' | 'status'>, ids?: number[]) {
    const qb = this.masterMeters
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.property', 'property')
      .leftJoinAndSelect('property.community', 'community');
    if (ids) qb.andWhere('m.id IN (:...ids)', { ids: ids.length ? ids : [0] });
    if (query.propertyId) qb.andWhere('property.id = :propertyId', { propertyId: query.propertyId });
    if (query.communityId) qb.andWhere('community.id = :communityId', { communityId: query.communityId });
    if (query.status) qb.andWhere('m.status = :status', { status: query.status });
    const rows = await qb.getMany();
    return rows.map((m) => ({
      masterMeterId: m.businessCode,
      serialNumber: m.serialNumber,
      dtuId: m.dtuId,
      community: m.property?.community?.name,
      property: m.property?.name,
      mBusAddress: m.mBusAddress,
      status: m.status,
      meterMake: m.meterMake,
      meterModel: m.meterModel,
      installationDate: m.installationDate,
    }));
  }

  private async buildSubMeterExportRows(query: Pick<MeterQueryDto, 'propertyId' | 'communityId' | 'status'>, ids?: number[]) {
    const qb = this.subMeters
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.property', 'property')
      .leftJoinAndSelect('property.community', 'community')
      .leftJoinAndSelect('s.unit', 'unit')
      .leftJoinAndSelect('s.masterMeter', 'masterMeter');
    if (ids) qb.andWhere('s.id IN (:...ids)', { ids: ids.length ? ids : [0] });
    if (query.propertyId) qb.andWhere('property.id = :propertyId', { propertyId: query.propertyId });
    if (query.communityId) qb.andWhere('community.id = :communityId', { communityId: query.communityId });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    const rows = await qb.getMany();
    return rows.map((s) => ({
      subMeterId: s.businessCode,
      serialNumber: s.serialNumber,
      masterMeterId: s.masterMeter?.businessCode,
      community: s.property?.community?.name,
      property: s.property?.name,
      unitNumber: s.unit?.unitNumber ?? '',
      mBusAddress: s.mBusAddress,
      status: s.status,
      floor: s.floor ?? '',
      meterMake: s.meterMake,
      meterModel: s.meterModel,
      installationDate: s.installationDate,
      customerAccountNumber: s.customerAccountNumber,
    }));
  }

  // ─── Import (upload → parse → validate → commit) ───────────────────────────

  // Every import attempt gets an audit entry, including ones that never
  // reach commitRows — a rejected file (wrong type, no valid rows, too
  // large, etc.) is still something an admin reviewing the audit trail
  // needs to see happened, not a silent no-op. runImport() (below) does the
  // actual work and throws on total failure same as before; this wrapper's
  // only job is to make sure that throw still produces a FAILED audit
  // record before propagating to the controller.
  async importMeters(
    meterType: MeterImportType,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string | undefined,
    actorId?: number,
  ): Promise<ImportSummary> {
    const batchId = generateBatchId();
    const startedAt = Date.now();
    try {
      return await this.runImport(meterType, fileBuffer, fileName, mimeType, actorId, batchId, startedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      await this.auditService.record({
        moduleName: 'Meter',
        entityId: 0,
        action: 'IMPORT_FAILED',
        oldValue: null,
        newValue: { batchId, fileName, importType: meterType, durationMs: Date.now() - startedAt, error: message },
        performedBy: actorId,
      });
      throw err;
    }
  }

  private async runImport(
    meterType: MeterImportType,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string | undefined,
    actorId: number | undefined,
    batchId: string,
    startedAt: number,
  ): Promise<ImportSummary> {
    if (!fileBuffer || fileBuffer.length === 0) throw new BadRequestException('Uploaded file is empty');
    if (fileBuffer.length > MAX_IMPORT_FILE_SIZE_BYTES) {
      throw new BadRequestException(`Uploaded file exceeds the ${MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024)}MB import size limit`);
    }
    // Both the extension AND the browser-declared MIME type must say
    // "xlsx" — neither is trustworthy alone (both come straight from the
    // client and are trivially spoofable), but requiring agreement between
    // two independently-set fields rejects the common accidental case (a
    // renamed .csv/.xls) earlier and with a clearer message, before ever
    // reaching ExcelJS's own structural parse, which is the actual
    // authoritative check (a file that lies about both but isn't valid
    // OOXML still fails at workbook.xlsx.load() below).
    if (!/\.xlsx$/i.test(fileName)) {
      throw new BadRequestException('Only .xlsx files are accepted for import');
    }
    if (mimeType && !ACCEPTED_IMPORT_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(`Unsupported file type "${mimeType}" — only .xlsx (Excel) files are accepted`);
    }

    const columns = (await this.getColumns(meterType)).filter((c) => c.enabled);
    if (columns.length === 0) throw new BadRequestException('No import columns are configured for this meter type');

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as any);
    } catch {
      throw new BadRequestException('Uploaded file is not a valid Excel (.xlsx) workbook');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount === 0) throw new BadRequestException('Uploaded file has no worksheet');

    const headerToField = new Map<string, string>();
    for (const c of columns) headerToField.set(c.displayLabel.trim().toLowerCase(), c.internalField);

    const fieldColumnIndex = new Map<string, number>();
    const unrecognizedHeaders: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const raw = cell.value;
      if (typeof raw !== 'string') return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const field = headerToField.get(trimmed.toLowerCase());
      if (field) fieldColumnIndex.set(field, colNumber);
      else unrecognizedHeaders.push(trimmed);
    });

    // Every header must match a currently enabled column's Excel Column
    // Header exactly (case-insensitive) — an unrecognized header is rejected
    // outright rather than silently skipped, so a stray/renamed/extra column
    // in the uploaded file surfaces immediately instead of quietly losing
    // data. Columns disabled in the Attribute config are correctly absent
    // from `columns` (already filtered by `.filter((c) => c.enabled)` above),
    // so a disabled column's old header is treated the same as any other
    // unrecognized header — reflecting that it's no longer part of the
    // template at all.
    if (unrecognizedHeaders.length > 0) {
      throw new BadRequestException(
        `Unrecognized column(s): ${unrecognizedHeaders.join(', ')}. Only columns configured in Attributes > Meter Management are accepted.`,
      );
    }

    const missingMandatory = columns.filter((c) => c.mandatory && !fieldColumnIndex.has(c.internalField));
    if (missingMandatory.length > 0) {
      throw new BadRequestException(`Missing required column(s): ${missingMandatory.map((c) => c.displayLabel).join(', ')}`);
    }

    // Duplicate detection scope — matches the DB-level UNIQUE constraints
    // added in MeterUniquenessMigrationService exactly (confirmed with the
    // business owner):
    //   - serialNumber: unique per table (Master Meters among themselves,
    //     Sub Meters among themselves) — NOT shared across the two tables.
    //   - dtuId: unique across all Master Meters (Sub Meters don't have one).
    //   - mBusAddress: NOT global — unique per Property for Master Meters
    //     (each Property is its own M-Bus segment), unique per Master Meter
    //     for Sub Meters (each Master Meter is its own segment). The same
    //     address value legitimately repeats across different
    //     segments/properties, matching real M-Bus protocol conventions.
    // Checked both within the uploaded file itself and against whatever's
    // already committed — this is app-layer defense-in-depth; the DB
    // constraints are what actually close the concurrent-import race (see
    // toCommitFailure), this is just what gives a clean per-row message
    // instead of a raw DB error for the common (non-racing) case.
    const seenInFile = {
      serialNumber: new Set<string>(),
      dtuId: new Set<string>(),
      businessCode: new Set<string>(),
    };
    // Master Meter mBusAddress is scoped per-Property; Sub Meter
    // mBusAddress is scoped per-Master-Meter — the map key is whichever
    // scope applies to `meterType`, never mixed.
    const seenMBusAddressByScope = new Map<number, Set<string>>();

    const existingSerialNumbers =
      meterType === MeterImportType.MASTER
        ? new Set((await this.masterMeters.find({ where: {}, select: ['serialNumber'] })).map((m) => m.serialNumber).filter((v): v is string => !!v))
        : new Set((await this.subMeters.find({ where: {}, select: ['serialNumber'] })).map((s) => s.serialNumber).filter((v): v is string => !!v));
    const existingDtuIds =
      meterType === MeterImportType.MASTER
        ? new Set((await this.masterMeters.find({ where: {}, select: ['dtuId'] })).map((m) => m.dtuId).filter((v): v is string => !!v))
        : new Set<string>();
    // Existing mBusAddress usage grouped by its scope key (property_id for
    // Master, master_meter_id for Sub) — a Map<scopeId, Set<address>>,
    // mirroring seenMBusAddressByScope's shape so both are checked the same
    // way in the row loop below.
    const existingMBusAddressByScope =
      meterType === MeterImportType.MASTER
        ? (await this.masterMeters.createQueryBuilder('m').select(['m.property_id AS propertyId', 'm.m_bus_address AS mBusAddress']).where('m.m_bus_address IS NOT NULL').getRawMany<{ propertyId: number; mBusAddress: string }>())
            .reduce((map, r) => {
              if (!map.has(r.propertyId)) map.set(r.propertyId, new Set());
              map.get(r.propertyId)!.add(r.mBusAddress);
              return map;
            }, new Map<number, Set<string>>())
        : (await this.subMeters.createQueryBuilder('s').select(['s.master_meter_id AS masterMeterId', 's.m_bus_address AS mBusAddress']).where('s.m_bus_address IS NOT NULL').getRawMany<{ masterMeterId: number; mBusAddress: string }>())
            .reduce((map, r) => {
              if (!map.has(r.masterMeterId)) map.set(r.masterMeterId, new Set());
              map.get(r.masterMeterId)!.add(r.mBusAddress);
              return map;
            }, new Map<number, Set<string>>());
    // The uploaded Master Meter ID / Sub-Meter ID column IS the entity's real
    // businessCode (see importType-specific commit logic below) — both share
    // the same physical column across both tables, so a Master Meter import
    // must also be checked against every existing Sub Meter code and vice
    // versa (a business_code collision across the two tables would still
    // violate the shared naming expectation even though no single DB
    // uniqueness constraint spans both tables).
    const existingBusinessCodes = new Set(
      (await this.masterMeters.find({ where: {}, select: ['businessCode'] }))
        .map((m) => m.businessCode)
        .concat((await this.subMeters.find({ where: {}, select: ['businessCode'] })).map((s) => s.businessCode))
        .filter((v): v is string => !!v),
    );
    // Property → Master Meter is a 1:1 business rule (a tower has exactly one
    // Master Meter) that has no DB-level uniqueness constraint on
    // master_meters.property_id — enforced here instead, both against
    // already-committed rows and against other rows in this same file
    // claiming the same Property.
    const propertiesWithMasterMeter =
      meterType === MeterImportType.MASTER
        ? new Set(
            (await this.masterMeters.createQueryBuilder('m').select('m.property_id', 'propertyId').getRawMany<{ propertyId: number }>()).map(
              (r) => r.propertyId,
            ),
          )
        : new Set<number>();
    const propertiesClaimedInFile = new Set<number>();
    // Unit → Sub Meter mapping is similarly a 1:1 business rule (one sub
    // meter per unit) with no DB-level uniqueness constraint on
    // sub_meters.unit_id — see the comment on SubMeter.unit in
    // entities/sub-meter.entity.ts.
    const unitsAlreadyMapped =
      meterType === MeterImportType.SUB
        ? new Set(
            (
              await this.subMeters.createQueryBuilder('s').select('s.unit_id', 'unitId').where('s.unit_id IS NOT NULL').getRawMany<{ unitId: number }>()
            ).map((r) => r.unitId),
          )
        : new Set<number>();
    const unitsClaimedInFile = new Set<number>();

    const validRows: ImportRow[] = [];
    const failedRecords: ImportFailedRecord[] = [];

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const isBlank = !row.values || (Array.isArray(row.values) && (row.values as unknown[]).every((v) => v === null || v === undefined));
      if (isBlank) continue;

      const record: ImportRow = {};
      // Each row collects (message, reasonType) pairs rather than plain
      // strings, so the API response can report a genuine category per
      // failure (Missing Required / Not Found / Mismatch / Duplicate) — the
      // underlying checks below are unchanged from the original
      // implementation, only the error accumulation is richer.
      const rowIssues: Array<{ message: string; reasonType: ImportFailureReason }> = [];

      for (const col of columns) {
        const idx = fieldColumnIndex.get(col.internalField);
        const cellValue = idx !== undefined ? row.getCell(idx).value : null;
        if (col.internalField === 'installationDate') {
          const parsed = parseExcelDateCell(cellValue);
          if (!parsed.ok) {
            rowIssues.push({ message: `${col.displayLabel} is not a valid date`, reasonType: ImportFailureReason.OTHER });
            record[col.internalField] = cellValue !== null && cellValue !== undefined ? String(cellValue).trim() : null;
          } else {
            record[col.internalField] = parsed.value;
          }
        } else {
          record[col.internalField] = cellValue !== null && cellValue !== undefined ? String(cellValue).trim() : null;
        }
      }

      for (const col of columns.filter((c) => c.mandatory)) {
        if (!record[col.internalField]) {
          rowIssues.push({ message: `${col.displayLabel} is required`, reasonType: ImportFailureReason.MISSING_REQUIRED });
        }
      }

      // Status must be one of the actual MeterStatus enum values — anything
      // else (a typo like "Actve", or a value from an unrelated system) is
      // rejected instead of silently defaulting to Active in commitRows().
      if (record.status && !Object.values(MeterStatus).includes(record.status.toLowerCase())) {
        rowIssues.push({
          message: `Status "${record.status}" is invalid — must be one of: ${Object.values(MeterStatus).join(', ')}`,
          reasonType: ImportFailureReason.OTHER,
        });
      }

      // Meter Make/Model are free-text but still bounded by the DB column
      // length (varchar(100)) — checked here so an over-length value fails
      // as a clean per-row message instead of an opaque DB error.
      for (const field of ['meterMake', 'meterModel'] as const) {
        const value = record[field];
        if (value && value.length > FREE_TEXT_MAX_LENGTH) {
          rowIssues.push({
            message: `${columnLabel(columns, field)} exceeds ${FREE_TEXT_MAX_LENGTH} characters`,
            reasonType: ImportFailureReason.OTHER,
          });
        }
      }

      // The uploaded Master Meter ID / Sub-Meter ID becomes the entity's
      // real businessCode (see commitRows) — bounded by the same
      // business_code varchar(20) column both tables share.
      const idField = meterType === MeterImportType.MASTER ? 'masterMeterId' : 'subMeterId';
      const uploadedCode: string | null = record[idField];
      if (uploadedCode && uploadedCode.length > BUSINESS_CODE_MAX_LENGTH) {
        rowIssues.push({
          message: `${columnLabel(columns, idField)} exceeds ${BUSINESS_CODE_MAX_LENGTH} characters`,
          reasonType: ImportFailureReason.OTHER,
        });
      }

      // Community Code is validated on its own first (so a typo'd community
      // surfaces as its own error) and then re-checked against the resolved
      // Property's actual community below — Community itself is never
      // persisted on Master/Sub Meter (it's only reachable via
      // property.community), so this column exists purely as a
      // cross-reference to catch a Property Code typed under the wrong
      // Community.
      let resolvedCommunityId: number | undefined;
      if (record.community) {
        const community = await this.communities
          .createQueryBuilder('c')
          .where('c.name = :name OR c.code = :name', { name: record.community })
          .getOne();
        if (!community) rowIssues.push({ message: `Community "${record.community}" not found`, reasonType: ImportFailureReason.NOT_FOUND });
        else resolvedCommunityId = community.id;
      }

      if (record.property) {
        const property = await this.properties
          .createQueryBuilder('p')
          .leftJoinAndSelect('p.community', 'community')
          .where('p.name = :name OR p.code = :name', { name: record.property })
          .getOne();
        if (!property) {
          rowIssues.push({ message: `Property "${record.property}" not found`, reasonType: ImportFailureReason.NOT_FOUND });
        } else if (resolvedCommunityId !== undefined && property.community.id !== resolvedCommunityId) {
          rowIssues.push({
            message: `Property "${record.property}" does not belong to Community "${record.community}"`,
            reasonType: ImportFailureReason.MISMATCH,
          });
        } else {
          record._resolvedPropertyId = property.id;
        }
      }

      if (meterType === MeterImportType.MASTER && record._resolvedPropertyId !== undefined) {
        // One Master Meter per Property — see propertiesWithMasterMeter/
        // propertiesClaimedInFile above for why this needs both a DB check
        // and an in-file check.
        if (propertiesWithMasterMeter.has(record._resolvedPropertyId)) {
          rowIssues.push({
            message: `Property "${record.property}" already has a Master Meter`,
            reasonType: ImportFailureReason.DUPLICATE,
          });
        } else if (propertiesClaimedInFile.has(record._resolvedPropertyId)) {
          rowIssues.push({
            message: `Property "${record.property}" is claimed by more than one row in this file`,
            reasonType: ImportFailureReason.DUPLICATE,
          });
        } else {
          propertiesClaimedInFile.add(record._resolvedPropertyId);
        }
      }

      if (meterType === MeterImportType.SUB) {
        if (record.masterMeterId) {
          const master = await this.masterMeters
            .createQueryBuilder('m')
            .leftJoinAndSelect('m.property', 'property')
            .where('m.businessCode = :code', { code: record.masterMeterId })
            .getOne();
          if (!master) {
            rowIssues.push({ message: `Master Meter "${record.masterMeterId}" not found`, reasonType: ImportFailureReason.NOT_FOUND });
          } else if (record._resolvedPropertyId !== undefined && master.property.id !== record._resolvedPropertyId) {
            rowIssues.push({
              message: `Master Meter "${record.masterMeterId}" does not belong to Property "${record.property}"`,
              reasonType: ImportFailureReason.MISMATCH,
            });
          } else {
            record._resolvedMasterMeterId = master.id;
          }
        }
        if (record.unitNumber && record._resolvedPropertyId) {
          const unit = await this.units.findOne({ where: { unitNumber: record.unitNumber, property: { id: record._resolvedPropertyId } } });
          if (!unit) {
            rowIssues.push({
              message: `Unit "${record.unitNumber}" not found under Property "${record.property}"`,
              reasonType: ImportFailureReason.NOT_FOUND,
            });
          } else if (unitsAlreadyMapped.has(unit.id)) {
            rowIssues.push({
              message: `Unit "${record.unitNumber}" already has a Sub Meter mapped to it`,
              reasonType: ImportFailureReason.DUPLICATE,
            });
          } else if (unitsClaimedInFile.has(unit.id)) {
            rowIssues.push({
              message: `Unit "${record.unitNumber}" is claimed by more than one row in this file`,
              reasonType: ImportFailureReason.DUPLICATE,
            });
          } else {
            record._resolvedUnitId = unit.id;
            unitsClaimedInFile.add(unit.id);
          }
        }
      }

      // Duplicate checks — against both already-committed DB rows and other
      // rows already seen earlier in this same file. Checked last so a row
      // that's already failing for another reason doesn't also get a
      // confusing secondary "duplicate" message layered on top of an
      // unrelated problem — though in practice a value can trip both a
      // not-found check (for a different column) and a duplicate check
      // (for this one) simultaneously, which is intentional: they're
      // different columns' problems, both real.
      for (const [field, existingSet] of [
        ['serialNumber', existingSerialNumbers],
        ['dtuId', existingDtuIds],
      ] as const) {
        const value = record[field];
        if (!value) continue;
        const seenSet = seenInFile[field];
        if (seenSet.has(value)) {
          rowIssues.push({ message: `Duplicate ${columnLabel(columns, field)} "${value}" (also used by an earlier row in this file)`, reasonType: ImportFailureReason.DUPLICATE });
        } else if (existingSet.has(value)) {
          rowIssues.push({ message: `Duplicate ${columnLabel(columns, field)} "${value}" (already exists in the system)`, reasonType: ImportFailureReason.DUPLICATE });
        } else {
          seenSet.add(value);
        }
      }

      // M-Bus Address is scoped to a segment, not global — Property for
      // Master Meters, Master Meter for Sub Meters (see the comment where
      // seenMBusAddressByScope/existingMBusAddressByScope are built). Only
      // checked once the row's scope has actually resolved (a row that
      // failed to resolve its Property/Master Meter already has a NOT_FOUND
      // issue and there's no scope to check the address within).
      const mBusScopeId = meterType === MeterImportType.MASTER ? record._resolvedPropertyId : record._resolvedMasterMeterId;
      if (record.mBusAddress && mBusScopeId !== undefined) {
        const seenInScope = seenMBusAddressByScope.get(mBusScopeId);
        const existingInScope = existingMBusAddressByScope.get(mBusScopeId);
        if (seenInScope?.has(record.mBusAddress)) {
          rowIssues.push({
            message: `Duplicate ${columnLabel(columns, 'mBusAddress')} "${record.mBusAddress}" (also used by an earlier row in this file for the same ${meterType === MeterImportType.MASTER ? 'Property' : 'Master Meter'})`,
            reasonType: ImportFailureReason.DUPLICATE,
          });
        } else if (existingInScope?.has(record.mBusAddress)) {
          rowIssues.push({
            message: `Duplicate ${columnLabel(columns, 'mBusAddress')} "${record.mBusAddress}" (already used by another meter on the same ${meterType === MeterImportType.MASTER ? 'Property' : 'Master Meter'})`,
            reasonType: ImportFailureReason.DUPLICATE,
          });
        } else {
          if (!seenMBusAddressByScope.has(mBusScopeId)) seenMBusAddressByScope.set(mBusScopeId, new Set());
          seenMBusAddressByScope.get(mBusScopeId)!.add(record.mBusAddress);
        }
      }

      // The uploaded Master Meter ID / Sub-Meter ID is this row's intended
      // businessCode — duplicate-checked the same way as serial/DTU/M-Bus
      // above, against both tables (see existingBusinessCodes comment).
      if (uploadedCode) {
        if (seenInFile.businessCode.has(uploadedCode)) {
          rowIssues.push({
            message: `Duplicate ${columnLabel(columns, idField)} "${uploadedCode}" (also used by an earlier row in this file)`,
            reasonType: ImportFailureReason.DUPLICATE,
          });
        } else if (existingBusinessCodes.has(uploadedCode)) {
          rowIssues.push({
            message: `Duplicate ${columnLabel(columns, idField)} "${uploadedCode}" (already exists in the system)`,
            reasonType: ImportFailureReason.DUPLICATE,
          });
        } else {
          seenInFile.businessCode.add(uploadedCode);
        }
      }

      if (rowIssues.length > 0) {
        // First issue's category represents the row for summary counting —
        // a row can have multiple problems, but "Duplicate Records" etc.
        // need one bucket per row, not per issue.
        failedRecords.push({
          rowNumber,
          reason: rowIssues.map((i) => i.message).join('; '),
          reasonType: rowIssues[0].reasonType,
          values: Object.fromEntries(columns.map((c) => [c.internalField, record[c.internalField] ?? null])),
        });
      } else {
        // Carries the original Excel row number through to commitRows() so
        // a DB-level failure there (a genuine race against a concurrent
        // import — see commitRows' per-row transaction) can still be
        // reported against the correct row instead of being lost.
        record._rowNumber = rowNumber;
        validRows.push(record);
      }
    }

    const totalRows = validRows.length + failedRecords.length;
    if (totalRows === 0) throw new BadRequestException('Uploaded file has no data rows');
    if (validRows.length === 0) {
      throw new BadRequestException(
        `No valid rows to import — all ${failedRecords.length} row(s) had errors: ${failedRecords.map((e) => `row ${e.rowNumber}: ${e.reason}`).join(' | ')}`,
      );
    }

    const { created, failed: commitFailures } = await this.commitRows(meterType, validRows, actorId, columns);
    // Rows that failed at the DB layer (post pre-commit-validation — see
    // commitRows/toCommitFailure) are merged into the same failedRecords
    // list the response and audit log both read, so a concurrent-import
    // race is reported identically to a validation failure rather than
    // being a second, invisible category of failure.
    const allFailedRecords = [...failedRecords, ...commitFailures];
    const durationMs = Date.now() - startedAt;
    const duplicateRows = allFailedRecords.filter((r) => r.reasonType === ImportFailureReason.DUPLICATE).length;

    const summary: ImportSummary = {
      batchId,
      fileName,
      importType: meterType,
      totalRows,
      successfulRows: created.length,
      failedRows: allFailedRecords.length,
      skippedRows: 0, // Nothing is currently skipped independently of failing — see entities/import-result.types.ts.
      duplicateRows,
      warnings: 0, // No warning-level (non-blocking) checks exist yet — every issue found today is a hard failure.
      durationMs,
      importedIds: created.map((c) => c.id),
      importedCodes: created.map((c) => c.businessCode).filter((v): v is string => !!v),
      failedRecords: allFailedRecords,
    };

    await this.auditService.record({
      moduleName: 'Meter',
      entityId: created[0]?.id ?? 0,
      action: 'IMPORT',
      oldValue: null,
      newValue: summary,
      performedBy: actorId,
    });
    return summary;
  }

  // ─── Import history ─────────────────────────────────────────────────────────

  // Reads back the ImportSummary JSON this same service wrote to AuditLog on
  // every importMeters() call (see the record() call above) — no separate
  // "import runs" table, the audit log IS the history, same convention every
  // other module's audit trail already follows. Includes IMPORT_FAILED rows
  // (a request that never reached commitRows — bad file type, no valid
  // rows, etc.) alongside IMPORT rows, so a totally-rejected import still
  // shows up here instead of leaving no trace at all.
  //
  // Shared by both getImportHistory() (flat, used by the Meter Management
  // dashboard's compact panel) and getImportHistoryPage() (filtered +
  // paginated, used by the Import Center screen) — the audit-log read and
  // JSON-parse-into-a-row logic is identical either way; only what each
  // caller does with the resulting rows differs.
  private async loadImportHistoryRows(fetchLimit: number) {
    const logs = await this.auditService.findByModule('Meter', ['IMPORT', 'IMPORT_FAILED'], fetchLimit);
    const performerIds = [...new Set(logs.map((l) => l.performedBy).filter((id): id is number => !!id))];
    const performers = performerIds.length
      ? await this.users.find({ where: performerIds.map((id) => ({ id })) })
      : [];
    const performerName = new Map(performers.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    return logs.map((log) => {
      let summary: Partial<ImportSummary> & { error?: string } = {};
      try {
        summary = log.newValue ? JSON.parse(log.newValue) : {};
      } catch {
        summary = {};
      }
      const isRejected = log.action === 'IMPORT_FAILED';
      return {
        id: log.id,
        batchId: summary.batchId ?? null,
        fileName: summary.fileName ?? null,
        importType: summary.importType ?? null,
        importedAt: log.createdAt,
        importedBy: log.performedBy ? performerName.get(log.performedBy) ?? `User #${log.performedBy}` : 'System',
        totalRows: summary.totalRows ?? 0,
        successfulRows: summary.successfulRows ?? 0,
        failedRows: summary.failedRows ?? 0,
        durationMs: summary.durationMs ?? 0,
        // A rejected import (IMPORT_FAILED) never produced a row count to
        // reason about — it's unconditionally 'failed', not derived from
        // successfulRows/failedRows the way a committed IMPORT row is.
        status: isRejected
          ? ('failed' as const)
          : (summary.failedRows ?? 0) > 0 && (summary.successfulRows ?? 0) === 0
            ? ('failed' as const)
            : (summary.failedRows ?? 0) > 0
              ? ('partial' as const)
              : ('success' as const),
      };
    });
  }

  async getImportHistory(limit = 50) {
    return this.loadImportHistoryRows(limit);
  }

  // Bounds how much audit-log history is ever pulled into memory for
  // filtering/pagination — the Import Center screen doesn't need to search
  // arbitrarily far back; this caps a pathological "give me page 9999" query
  // from scanning the entire audit log table.
  private static readonly IMPORT_HISTORY_SCAN_LIMIT = 500;

  // Columns the Recent Imports table may sort by — every one of these lives
  // only inside the audit log's parsed JSON blob (fileName/importType/
  // totalRows/failedRows/status) or is resolved after the fact (importedBy),
  // so there's no real DB column to ORDER BY; this whitelist guards which
  // in-memory field name we're allowed to read off a row before sorting,
  // mirroring BillingCycleService.findAll()'s SORTABLE-set guard idiom.
  private static readonly IMPORT_HISTORY_SORTABLE = new Set([
    'fileName',
    'importType',
    'importedBy',
    'importedAt',
    'totalRows',
    'failedRows',
    'status',
  ]);

  async getImportHistoryPage(filters: {
    type?: 'master_meter' | 'sub_meter';
    status?: 'success' | 'failed' | 'partial';
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  }) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;
    const sortBy = MeterService.IMPORT_HISTORY_SORTABLE.has(filters.sortBy ?? '') ? filters.sortBy! : 'importedAt';
    const sortOrder = filters.sortOrder ?? 'DESC';

    const allRows = await this.loadImportHistoryRows(MeterService.IMPORT_HISTORY_SCAN_LIMIT);

    const filteredRows = allRows.filter((row) => {
      if (filters.type) {
        const rowType = row.importType === MeterImportType.MASTER ? 'master_meter' : row.importType === MeterImportType.SUB ? 'sub_meter' : null;
        if (rowType !== filters.type) return false;
      }
      if (filters.status && row.status !== filters.status) return false;
      return true;
    });

    const direction = sortOrder === 'ASC' ? 1 : -1;
    const sortedRows = [...filteredRows].sort((a, b) => {
      const aValue = a[sortBy as keyof typeof a];
      const bValue = b[sortBy as keyof typeof b];
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === 'number' && typeof bValue === 'number') return (aValue - bValue) * direction;
      return String(aValue).localeCompare(String(bValue)) * direction;
    });

    const total = sortedRows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const items = sortedRows.slice(start, start + pageSize);

    return {
      items,
      pagination: { page, limit: pageSize, total, totalPages },
    };
  }

  // Filter option metadata for the Import Center's Type/Status dropdowns —
  // mirrors TariffService.getFilterMetadata() / BillingCycleService's
  // metaFilters endpoint: both are fixed, system-defined workflow values
  // (MeterImportType is a real backend enum; status is a runtime-derived
  // 3-state union, never business-configurable), so this stays a plain
  // enum-reflecting endpoint rather than a LOV Master category.
  async getImportHistoryMetaFilters() {
    return {
      types: [
        { value: 'master_meter', label: MeterImportType.MASTER },
        { value: 'sub_meter', label: MeterImportType.SUB },
      ],
      statuses: [
        { value: 'success', label: 'Success' },
        { value: 'failed', label: 'Failed' },
        { value: 'partial', label: 'Partial' },
      ],
    };
  }

  // ─── Import error / success reports ─────────────────────────────────────────
  // Both reuse the same enabled-columns config as the template/import path
  // (getColumns()) so a re-downloaded error report has the exact same
  // columns as the original template plus one trailing "Failure Reason"
  // column — ready to fix and re-upload through the normal import endpoint,
  // no separate re-import code path needed.

  async buildImportErrorReport(meterType: MeterImportType, failedRecords: ImportFailedRecord[], batchId?: string): Promise<Buffer> {
    const columns = (await this.getColumns(meterType)).filter((c) => c.enabled);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Failed Records');
    const generatedAt = new Date().toISOString();
    sheet.columns = [
      { header: 'Row Number', key: '_rowNumber', width: 12 },
      ...columns.map((c) => ({ header: c.displayLabel, key: c.internalField, width: 22 })),
      { header: 'Reason Type', key: '_reasonType', width: 18 },
      { header: 'Failure Reason', key: '_reason', width: 50 },
      { header: 'Batch ID', key: '_batchId', width: 22 },
      { header: 'Generated At', key: '_generatedAt', width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const record of failedRecords) {
      const sanitizedValues = Object.fromEntries(
        Object.entries(record.values).map(([key, value]) => [key, sanitizeForExcel(value)]),
      );
      sheet.addRow({
        _rowNumber: record.rowNumber,
        ...sanitizedValues,
        _reasonType: record.reasonType,
        _reason: sanitizeForExcel(record.reason),
        _batchId: batchId ?? '',
        _generatedAt: generatedAt,
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async buildImportSuccessReport(meterType: MeterImportType, ids: number[]): Promise<Buffer> {
    const columns = (await this.getColumns(meterType)).filter((c) => c.enabled);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Imported Records');
    sheet.columns = columns.map((c) => ({ header: c.displayLabel, key: c.internalField, width: 22 }));
    sheet.getRow(1).font = { bold: true };

    if (ids.length > 0) {
      // Reuses the same row-shape builders the regular Export button already
      // uses (buildMasterMeterExportRows/buildSubMeterExportRows), scoped to
      // just this import's ids instead of the list screen's filters — no
      // second copy of the entity→row mapping.
      const rows =
        meterType === MeterImportType.MASTER
          ? await this.buildMasterMeterExportRows({}, ids)
          : await this.buildSubMeterExportRows({}, ids);
      sheet.addRows(rows);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // Bulk-import rows carry their own business identifier (the uploaded
  // Master Meter ID / Sub-Meter ID column, already validated for uniqueness
  // and length in importMeters()) — unlike createMasterMeter/createSubMeter
  // (the manual create-one-record UI form), which still auto-generates a
  // businessCode via generateBusinessCode() when the caller doesn't supply
  // one. Both paths converge on the same `business_code` column with the
  // same DB-level uniqueness constraint; only the source of the value
  // differs.
  //
  // Each row commits inside its OWN transaction (not one transaction for the
  // whole batch) so a genuine DB-level failure on one row — most commonly a
  // unique-constraint race against a second, concurrent import that both
  // validated against the same pre-import snapshot and both chose the same
  // business code — can never leave that row half-written, while still
  // letting every other valid row commit normally. A batch-wide transaction
  // would have made one bad row roll back the entire import, which is
  // worse: 11 genuinely valid rows would be discarded because of 1 row that
  // lost a race no validation pass could have foreseen.
  private async commitRows(
    meterType: MeterImportType,
    rows: ImportRow[],
    actorId: number | undefined,
    columns: ColumnConfig[],
  ): Promise<{ created: Array<MasterMeter | SubMeter>; failed: ImportFailedRecord[] }> {
    const created: Array<MasterMeter | SubMeter> = [];
    const failed: ImportFailedRecord[] = [];

    if (meterType === MeterImportType.MASTER) {
      for (const r of rows) {
        try {
          const saved = await this.dataSource.transaction(async (manager) => {
            const entity = manager.create(MasterMeter, {
              businessCode: r.masterMeterId,
              serialNumber: r.serialNumber ?? null,
              dtuId: r.dtuId ?? null,
              property: { id: r._resolvedPropertyId } as any,
              mBusAddress: r.mBusAddress ?? null,
              status: r.status?.toLowerCase?.() === 'inactive' ? MeterStatus.INACTIVE : MeterStatus.ACTIVE,
              meterMake: r.meterMake ?? null,
              meterModel: r.meterModel ?? null,
              installationDate: r.installationDate || null,
              createdByUser: actorId ? ({ id: actorId } as any) : null,
            });
            return manager.save(MasterMeter, entity);
          });
          created.push(saved);
        } catch (err) {
          failed.push(this.toCommitFailure(r, err, columns));
        }
      }
    } else {
      for (const r of rows) {
        try {
          const saved = await this.dataSource.transaction(async (manager) => {
            const entity = manager.create(SubMeter, {
              businessCode: r.subMeterId,
              serialNumber: r.serialNumber ?? null,
              masterMeter: { id: r._resolvedMasterMeterId } as any,
              property: { id: r._resolvedPropertyId } as any,
              unit: r._resolvedUnitId ? ({ id: r._resolvedUnitId } as any) : null,
              mBusAddress: r.mBusAddress ?? null,
              status: r.status?.toLowerCase?.() === 'inactive' ? MeterStatus.INACTIVE : MeterStatus.ACTIVE,
              floor: r.floor ? Number(r.floor) : null,
              meterMake: r.meterMake ?? null,
              meterModel: r.meterModel ?? null,
              installationDate: r.installationDate || null,
              customerAccountNumber: r.customerAccountNumber ?? null,
              createdByUser: actorId ? ({ id: actorId } as any) : null,
            });
            const savedEntity = await manager.save(SubMeter, entity);
            return savedEntity;
          });
          created.push(saved);
        } catch (err) {
          failed.push(this.toCommitFailure(r, err, columns));
        }
      }
    }
    return { created, failed };
  }

  // A row that passed every pre-commit validation can still fail at the DB
  // layer — almost always a unique-constraint collision from a concurrent
  // import (see the commitRows comment above). Reported the same way a
  // validation failure is, so it shows up in the Failed Records grid and
  // the downloadable error report identically, rather than crashing the
  // whole request.
  // MySQL's duplicate-key error message names the exact index that was
  // violated (e.g. "Duplicate entry 'X' for key
  // 'master_meters.UQ_master_meters_serial_number'") — mapped here to a
  // human-readable field/scope description so a genuine concurrent-import
  // race reports exactly which uniqueness rule was lost, the same way an
  // app-layer validation failure would, instead of a generic "duplicate"
  // message that doesn't say which field.
  private static readonly COMMIT_DUPLICATE_INDEX_MESSAGES: Record<string, string> = {
    UQ_master_meters_serial_number: 'Serial Number is already used by another Master Meter',
    UQ_master_meters_dtu_id: 'DTU ID is already used by another Master Meter',
    UQ_master_meters_property_mbus: 'M-Bus Address is already used by another Master Meter on the same Property',
    UQ_master_meters_property_id: 'This Property already has a Master Meter',
    UQ_sub_meters_serial_number: 'Serial Number is already used by another Sub Meter',
    UQ_sub_meters_master_meter_mbus: 'M-Bus Address is already used by another Sub Meter on the same Master Meter',
  };

  private toCommitFailure(row: ImportRow, err: unknown, columns: ColumnConfig[]): ImportFailedRecord {
    const message = err instanceof Error ? err.message : 'Failed to save this record';
    const isDuplicateKey = /duplicate entry/i.test(message) || (err as { code?: string })?.code === 'ER_DUP_ENTRY';
    const violatedIndex = Object.keys(MeterService.COMMIT_DUPLICATE_INDEX_MESSAGES).find((indexName) => message.includes(indexName));
    const reason = violatedIndex
      ? `${MeterService.COMMIT_DUPLICATE_INDEX_MESSAGES[violatedIndex]} — created by another import running at the same time`
      : isDuplicateKey
        ? 'This record could not be saved because a matching record was created by another import at the same time'
        : `This record could not be saved: ${message}`;
    return {
      rowNumber: row._rowNumber,
      reason,
      reasonType: isDuplicateKey ? ImportFailureReason.DUPLICATE : ImportFailureReason.OTHER,
      values: Object.fromEntries(columns.map((c) => [c.internalField, row[c.internalField] ?? null])),
    };
  }

  // Single-record equivalent of toCommitFailure() above, for create paths
  // outside bulk import (currently just createMasterMeter()) that have no
  // pre-check against one of the named unique indexes and would otherwise
  // let a raw MySQL duplicate-key error reach the client as a generic 500.
  // A non-duplicate-key error is rethrown completely unchanged — this only
  // ever translates the one error shape it actually understands.
  private toDuplicateKeyException(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    const isDuplicateKey = /duplicate entry/i.test(message) || (err as { code?: string })?.code === 'ER_DUP_ENTRY';
    if (!isDuplicateKey) return err instanceof Error ? err : new Error(message);

    const violatedIndex = Object.keys(MeterService.COMMIT_DUPLICATE_INDEX_MESSAGES).find((indexName) => message.includes(indexName));
    return new BadRequestException(violatedIndex ? MeterService.COMMIT_DUPLICATE_INDEX_MESSAGES[violatedIndex] : 'This record could not be saved because it duplicates an existing one');
  }

  // ─── Response mappers ───────────────────────────────────────────────────────

  private mapMasterMeterResponse(m: MasterMeter) {
    return {
      id: m.id,
      code: m.businessCode,
      serialNumber: m.serialNumber,
      dtuId: m.dtuId,
      propertyId: m.property?.id ?? null,
      propertyName: m.property?.name ?? null,
      communityName: m.property?.community?.name ?? null,
      mBusAddress: m.mBusAddress,
      status: m.status,
      meterMake: m.meterMake,
      meterModel: m.meterModel,
      installationDate: m.installationDate,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  private mapSubMeterResponse(s: SubMeter) {
    return {
      id: s.id,
      code: s.businessCode,
      serialNumber: s.serialNumber,
      masterMeterId: s.masterMeter?.id ?? null,
      masterMeterCode: s.masterMeter?.businessCode ?? null,
      propertyId: s.property?.id ?? null,
      propertyName: s.property?.name ?? null,
      communityName: s.property?.community?.name ?? null,
      unitId: s.unit?.id ?? null,
      unitNumber: s.unit?.unitNumber ?? null,
      mBusAddress: s.mBusAddress,
      status: s.status,
      floor: s.floor,
      meterMake: s.meterMake,
      meterModel: s.meterModel,
      installationDate: s.installationDate,
      customerAccountNumber: s.customerAccountNumber,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}

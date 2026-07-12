import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { AttributeService } from '../attribute/attribute.service';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../../common/utils/business-code.util';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import {
  CreateMasterMeterDto,
  CreateSubMeterDto,
  MeterQueryDto,
  SetMeterStatusDto,
  UpdateMasterMeterDto,
  UpdateSubMeterDto,
} from './dto/meter.dto';
import { MasterMeter } from './entities/master-meter.entity';
import { MeterImportType } from './entities/meter-import-type.enum';
import { MeterStatus } from './entities/meter-status.enum';
import { SubMeter } from './entities/sub-meter.entity';

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

type ImportRow = Record<string, any>;

@Injectable()
export class MeterService {
  constructor(
    @InjectRepository(MasterMeter) private readonly masterMeters: Repository<MasterMeter>,
    @InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>,
    @InjectRepository(Community) private readonly communities: Repository<Community>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(Unit) private readonly units: Repository<Unit>,
    private readonly attributeService: AttributeService,
    private readonly auditService: AuditService,
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
    const mappedMeters = await this.subMeters.createQueryBuilder('s').where('s.unit_id IS NOT NULL').getCount();
    return {
      totalCommunities,
      totalProperties,
      totalUnits,
      totalMasterMeters,
      totalSubMeters,
      mappedMeters,
      unmappedMeters: totalSubMeters - mappedMeters,
    };
  }

  async getCommunitiesOverview() {
    const communities = await this.communities.find({ order: { name: 'ASC' } });
    if (communities.length === 0) return [];

    const toMap = (rows: Array<{ communityId: string; count: string }>) =>
      new Map(rows.map((r) => [Number(r.communityId), Number(r.count)]));

    const [unitRows, propertyRows, masterRows, subRows, mappedRows] = await Promise.all([
      this.units.createQueryBuilder('u').innerJoin('u.property', 'p').select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      this.properties.createQueryBuilder('p').select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      this.masterMeters.createQueryBuilder('m').innerJoin('m.property', 'p').select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      this.subMeters.createQueryBuilder('s').innerJoin('s.property', 'p').select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
      this.subMeters.createQueryBuilder('s').innerJoin('s.property', 'p').where('s.unit_id IS NOT NULL').select('p.community_id', 'communityId').addSelect('COUNT(*)', 'count').groupBy('p.community_id').getRawMany(),
    ]);
    const unitsMap = toMap(unitRows), propsMap = toMap(propertyRows), mmMap = toMap(masterRows), smMap = toMap(subRows), mappedMap = toMap(mappedRows);

    return communities.map((c) => {
      const totalSubMeters = smMap.get(c.id) ?? 0;
      const mappedMeters = mappedMap.get(c.id) ?? 0;
      return {
        id: c.id,
        code: c.businessCode ?? c.code,
        name: c.name,
        totalProperties: propsMap.get(c.id) ?? 0,
        totalUnits: unitsMap.get(c.id) ?? 0,
        totalMasterMeters: mmMap.get(c.id) ?? 0,
        totalSubMeters,
        mappedMeters,
        unmappedMeters: totalSubMeters - mappedMeters,
        status: c.status,
      };
    });
  }

  async getCommunityDetail(communityId: number) {
    const community = await this.communities.findOne({ where: { id: communityId } });
    if (!community) throw new NotFoundException('Community not found');
    const overview = await this.getCommunitiesOverview();
    const summary = overview.find((c) => c.id === communityId) ?? null;
    return { community: { id: community.id, name: community.name, code: community.businessCode ?? community.code, status: community.status }, summary };
  }

  async getPropertiesOverview(communityId: number) {
    const properties = await this.properties.find({ where: { community: { id: communityId } }, order: { name: 'ASC' } });
    if (properties.length === 0) return [];
    const propertyIds = properties.map((p) => p.id);

    const toMap = (rows: Array<{ propertyId: string; count: string }>) =>
      new Map(rows.map((r) => [Number(r.propertyId), Number(r.count)]));

    const [unitRows, masterRows, subRows, mappedRows] = await Promise.all([
      this.units.createQueryBuilder('u').where('u.property_id IN (:...ids)', { ids: propertyIds }).select('u.property_id', 'propertyId').addSelect('COUNT(*)', 'count').groupBy('u.property_id').getRawMany(),
      this.masterMeters.createQueryBuilder('m').where('m.property_id IN (:...ids)', { ids: propertyIds }).select('m.property_id', 'propertyId').addSelect('COUNT(*)', 'count').groupBy('m.property_id').getRawMany(),
      this.subMeters.createQueryBuilder('s').where('s.property_id IN (:...ids)', { ids: propertyIds }).select('s.property_id', 'propertyId').addSelect('COUNT(*)', 'count').groupBy('s.property_id').getRawMany(),
      this.subMeters.createQueryBuilder('s').where('s.property_id IN (:...ids)', { ids: propertyIds }).andWhere('s.unit_id IS NOT NULL').select('s.property_id', 'propertyId').addSelect('COUNT(*)', 'count').groupBy('s.property_id').getRawMany(),
    ]);
    const unitsMap = toMap(unitRows), mmMap = toMap(masterRows), smMap = toMap(subRows), mappedMap = toMap(mappedRows);

    return properties.map((p) => {
      const totalSubMeters = smMap.get(p.id) ?? 0;
      const mappedMeters = mappedMap.get(p.id) ?? 0;
      return {
        id: p.id,
        code: p.businessCode ?? p.code,
        name: p.name,
        totalUnits: unitsMap.get(p.id) ?? 0,
        totalMasterMeters: mmMap.get(p.id) ?? 0,
        totalSubMeters,
        mappedMeters,
        unmappedMeters: totalSubMeters - mappedMeters,
        status: p.status,
      };
    });
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
        unmappedSubMeters: subMeters.length - mappedSubMeters,
        occupiedUnits: units.filter((u) => u.occupancyStatus === 'occupied').length,
        vacantUnits: units.filter((u) => u.occupancyStatus === 'vacant').length,
      },
      units: units.map((u) => ({
        id: u.id,
        unitNumber: u.unitNumber,
        occupancyStatus: u.occupancyStatus,
        status: u.status,
        subMeter: subMeterByUnitId.has(u.id) ? this.mapSubMeterResponse(subMeterByUnitId.get(u.id)!) : null,
      })),
    };
  }

  // ─── Master Meter CRUD ──────────────────────────────────────────────────────

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
    qb.orderBy('m.id', 'DESC');
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
    const saved = await this.masterMeters.save(entity);
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
    qb.orderBy('s.id', 'DESC');
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

    if (unit) await this.syncUnitMeterFields(unit.id, saved.businessCode, masterMeter.businessCode ?? null);

    await this.auditService.record({ moduleName: 'Meter', entityId: saved.id, action: 'CREATE', oldValue: null, newValue: saved, performedBy: actorId });
    return this.findOneSubMeter(saved.id);
  }

  async updateSubMeter(id: number, dto: UpdateSubMeterDto, actorId?: number) {
    const meter = await this.subMeters.findOne({ where: { id }, relations: ['unit', 'masterMeter'] });
    if (!meter) throw new NotFoundException('Sub meter not found');
    const oldValue = { ...meter };
    const previousUnitId = meter.unit?.id ?? null;

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
    const newUnitId = saved.unit?.id ?? null;

    if (previousUnitId && previousUnitId !== newUnitId) {
      await this.units.update(previousUnitId, { subMeterId: null, masterMeterId: null });
    }
    if (newUnitId) {
      await this.syncUnitMeterFields(newUnitId, saved.businessCode ?? null, saved.masterMeter?.businessCode ?? null);
    }

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

  private async syncUnitMeterFields(unitId: number, subMeterCode: string | null, masterMeterCode: string | null) {
    await this.units.update(unitId, { subMeterId: subMeterCode, masterMeterId: masterMeterCode });
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

  private async buildMasterMeterExportRows(query: MeterQueryDto) {
    const qb = this.masterMeters
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.property', 'property')
      .leftJoinAndSelect('property.community', 'community');
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

  private async buildSubMeterExportRows(query: MeterQueryDto) {
    const qb = this.subMeters
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.property', 'property')
      .leftJoinAndSelect('property.community', 'community')
      .leftJoinAndSelect('s.unit', 'unit')
      .leftJoinAndSelect('s.masterMeter', 'masterMeter');
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

  async importMeters(meterType: MeterImportType, fileBuffer: Buffer, fileName: string, actorId?: number) {
    const columns = (await this.getColumns(meterType)).filter((c) => c.enabled);
    if (columns.length === 0) throw new BadRequestException('No import columns are configured for this meter type');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Uploaded file has no worksheet');

    const headerToField = new Map<string, string>();
    for (const c of columns) headerToField.set(c.displayLabel.trim().toLowerCase(), c.internalField);

    const fieldColumnIndex = new Map<string, number>();
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const raw = cell.value;
      if (typeof raw !== 'string') return;
      const field = headerToField.get(raw.trim().toLowerCase());
      if (field) fieldColumnIndex.set(field, colNumber);
    });

    const missingMandatory = columns.filter((c) => c.mandatory && !fieldColumnIndex.has(c.internalField));
    if (missingMandatory.length > 0) {
      throw new BadRequestException(`Missing required column(s): ${missingMandatory.map((c) => c.displayLabel).join(', ')}`);
    }

    const validRows: ImportRow[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const isBlank = !row.values || (Array.isArray(row.values) && (row.values as unknown[]).every((v) => v === null || v === undefined));
      if (isBlank) continue;

      const record: ImportRow = {};
      for (const col of columns) {
        const idx = fieldColumnIndex.get(col.internalField);
        const cellValue = idx !== undefined ? row.getCell(idx).value : null;
        record[col.internalField] = cellValue !== null && cellValue !== undefined ? String(cellValue).trim() : null;
      }

      const rowErrors: string[] = [];
      for (const col of columns.filter((c) => c.mandatory)) {
        if (!record[col.internalField]) rowErrors.push(`${col.displayLabel} is required`);
      }

      if (record.property) {
        const property = await this.properties
          .createQueryBuilder('p')
          .leftJoinAndSelect('p.community', 'community')
          .where('p.name = :name OR p.code = :name', { name: record.property })
          .getOne();
        if (!property) rowErrors.push(`Property "${record.property}" not found`);
        else record._resolvedPropertyId = property.id;
      }

      if (meterType === MeterImportType.SUB) {
        if (record.masterMeterId) {
          const master = await this.masterMeters.findOne({ where: { businessCode: record.masterMeterId } });
          if (!master) rowErrors.push(`Master Meter "${record.masterMeterId}" not found`);
          else record._resolvedMasterMeterId = master.id;
        }
        if (record.unitNumber && record._resolvedPropertyId) {
          const unit = await this.units.findOne({ where: { unitNumber: record.unitNumber, property: { id: record._resolvedPropertyId } } });
          if (unit) record._resolvedUnitId = unit.id;
        }
      }

      if (rowErrors.length > 0) errors.push({ row: rowNumber, message: rowErrors.join('; ') });
      else validRows.push(record);
    }

    const totalRows = validRows.length + errors.length;
    if (totalRows === 0) throw new BadRequestException('Uploaded file has no data rows');
    if (validRows.length === 0) {
      throw new BadRequestException(`No valid rows to import — all ${errors.length} row(s) had errors: ${errors.map((e) => `row ${e.row}: ${e.message}`).join(' | ')}`);
    }

    const created = await this.commitRows(meterType, validRows, actorId);
    await this.auditService.record({
      moduleName: 'Meter',
      entityId: created[0]?.id ?? 0,
      action: 'IMPORT',
      oldValue: null,
      newValue: { fileName, totalRows, created: created.length },
      performedBy: actorId,
    });
    return { created: created.length, errorRows: errors.length, errors };
  }

  private async commitRows(meterType: MeterImportType, rows: ImportRow[], actorId?: number) {
    const created: Array<MasterMeter | SubMeter> = [];
    if (meterType === MeterImportType.MASTER) {
      for (const r of rows) {
        const entity = this.masterMeters.create({
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
        const saved = await this.masterMeters.save(entity);
        saved.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.MASTER_METER, saved.id);
        await this.masterMeters.update(saved.id, { businessCode: saved.businessCode });
        created.push(saved);
      }
    } else {
      for (const r of rows) {
        const entity = this.subMeters.create({
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
        const saved = await this.subMeters.save(entity);
        saved.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.SUB_METER, saved.id);
        await this.subMeters.update(saved.id, { businessCode: saved.businessCode });
        if (r._resolvedUnitId) {
          const master = await this.masterMeters.findOne({ where: { id: r._resolvedMasterMeterId } });
          await this.syncUnitMeterFields(r._resolvedUnitId, saved.businessCode, master?.businessCode ?? null);
        }
        created.push(saved);
      }
    }
    return created;
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

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MeterService } from './meter.service';
import { MasterMeter } from './entities/master-meter.entity';
import { SubMeter } from './entities/sub-meter.entity';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { User } from '../user/entities/user.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { AttributeService } from '../attribute/attribute.service';
import { AuditService } from '../../audit/audit.service';
import { CustomerService } from '../customer/customer.service';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';

// Isolated tests for the RBAC remediation fix: PATCH sub-meters/:id was @Permission('METER_INVENTORY_EDIT',
// 'METER_MAPPING') OR'd together, but the handler applied all 8 UpdateSubMeterDto fields
// unconditionally regardless of which code actually matched — METER_MAPPING's own seeded
// description scopes it to "map/unmap/change which unit a sub meter is mapped to" only, so a role
// holding ONLY that code could previously also rewrite serialNumber/mBusAddress/floor/meterMake/
// meterModel/installationDate/customerAccountNumber, none of which match its label. MeterService.
// updateSubMeter now does the field-level check itself (mirrors AttributeService.update's own
// established pattern for the same class of problem) — this suite exercises that logic directly, no
// real database connection.
describe('MeterService.updateSubMeter field-level scope', () => {
  let service: MeterService;
  let subMetersRepo: { findOne: jest.Mock; save: jest.Mock };
  let unitsRepo: { findOne: jest.Mock };
  let roleHasAction: jest.Mock;
  let auditService: { record: jest.Mock };

  const EXISTING_METER = {
    id: 55,
    serialNumber: 'SMT-OLD-001',
    unit: null,
    masterMeter: { id: 1 },
    mBusAddress: 'A1',
    floor: 3,
    meterMake: 'Kamstrup',
    meterModel: 'MC601',
    installationDate: '2025-01-01',
    customerAccountNumber: 'ACC-001',
  };

  beforeEach(async () => {
    subMetersRepo = {
      findOne: jest.fn().mockResolvedValue({ ...EXISTING_METER }),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    unitsRepo = { findOne: jest.fn().mockResolvedValue({ id: 42 }) };
    roleHasAction = jest.fn();
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MeterService,
        { provide: getRepositoryToken(MasterMeter), useValue: {} },
        { provide: getRepositoryToken(SubMeter), useValue: subMetersRepo },
        { provide: getRepositoryToken(Community), useValue: {} },
        { provide: getRepositoryToken(Property), useValue: {} },
        { provide: getRepositoryToken(Unit), useValue: unitsRepo },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: getRepositoryToken(MeterReading), useValue: {} },
        { provide: AttributeService, useValue: {} },
        { provide: AuditService, useValue: auditService },
        { provide: CustomerService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: RolePermissionsService, useValue: { roleHasAction } },
      ],
    }).compile();

    service = moduleRef.get(MeterService);
    // findOneSubMeter (called at the end of a successful update) re-queries and maps the response —
    // stub it directly so these tests stay focused on the authorization decision, not the response shape.
    jest.spyOn(service, 'findOneSubMeter').mockResolvedValue({ id: 55 } as any);
  });

  it('a role holding ONLY METER_MAPPING can change unitId alone (the one field it actually covers)', async () => {
    roleHasAction.mockImplementation((_roleId: number, code: string) => Promise.resolve(code === 'METER_MAPPING'));

    await expect(service.updateSubMeter(55, { unitId: 42 } as any, 7, 3)).resolves.toBeDefined();
    expect(roleHasAction).not.toHaveBeenCalledWith(3, 'METER_INVENTORY_EDIT');
  });

  it('a role holding ONLY METER_MAPPING is REJECTED when the request also changes a non-mapping field (the confirmed security fix)', async () => {
    roleHasAction.mockImplementation((_roleId: number, code: string) => Promise.resolve(code === 'METER_MAPPING'));

    await expect(
      service.updateSubMeter(55, { unitId: 42, serialNumber: 'SMT-NEW-001' } as any, 7, 3),
    ).rejects.toThrow(ForbiddenException);
    expect(subMetersRepo.save).not.toHaveBeenCalled();
  });

  it.each([
    ['serialNumber', 'SMT-NEW-001'],
    ['mBusAddress', 'B2'],
    ['floor', 5],
    ['meterMake', 'Sensus'],
    ['meterModel', 'PolluCom'],
    ['installationDate', '2026-01-01'],
    ['customerAccountNumber', 'ACC-002'],
  ])('a role holding ONLY METER_MAPPING is rejected for the single non-mapping field %s', async (field, value) => {
    roleHasAction.mockImplementation((_roleId: number, code: string) => Promise.resolve(code === 'METER_MAPPING'));

    await expect(service.updateSubMeter(55, { [field]: value } as any, 7, 3)).rejects.toThrow(ForbiddenException);
  });

  it('a role holding METER_INVENTORY_EDIT can change every field, including non-mapping ones (unchanged, full access preserved)', async () => {
    roleHasAction.mockImplementation((_roleId: number, code: string) => Promise.resolve(code === 'METER_INVENTORY_EDIT'));

    await expect(
      service.updateSubMeter(55, { unitId: 42, serialNumber: 'SMT-NEW-001', floor: 5 } as any, 7, 3),
    ).resolves.toBeDefined();
    expect(subMetersRepo.save).toHaveBeenCalled();
  });

  it('a role holding BOTH codes can change every field (METER_INVENTORY_EDIT alone is sufficient)', async () => {
    const held = new Set(['METER_INVENTORY_EDIT', 'METER_MAPPING']);
    roleHasAction.mockImplementation((_roleId: number, code: string) => Promise.resolve(held.has(code)));

    await expect(
      service.updateSubMeter(55, { serialNumber: 'SMT-NEW-001' } as any, 7, 3),
    ).resolves.toBeDefined();
  });

  it('no actorRoleId resolved (undefined) is treated as no grant — rejected for non-mapping fields', async () => {
    await expect(
      service.updateSubMeter(55, { serialNumber: 'SMT-NEW-001' } as any, 7, undefined),
    ).rejects.toThrow(ForbiddenException);
    expect(roleHasAction).not.toHaveBeenCalled();
  });

  it('a mapping-only request (unitId: null, unmapping) does not require METER_INVENTORY_EDIT', async () => {
    roleHasAction.mockImplementation((_roleId: number, code: string) => Promise.resolve(code === 'METER_MAPPING'));

    await expect(service.updateSubMeter(55, { unitId: null } as any, 7, 3)).resolves.toBeDefined();
  });
});

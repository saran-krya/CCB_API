import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MeterService } from './meter.service';
import { MeterController } from './meter.controller';
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
//
// The actor is identified by their LIVE role set (principal.roleIds — every role the user holds right
// now, resolved per request), and a code granted by ANY of those roles counts: rolesHaveAction mocks
// below model that union, so the multi-role cases prove a secondary role's grant is honoured and a
// role that lacks the code never takes it away from another.
describe('MeterService.updateSubMeter field-level scope', () => {
  let service: MeterService;
  let subMetersRepo: { findOne: jest.Mock; save: jest.Mock };
  let unitsRepo: { findOne: jest.Mock };
  let rolesHaveAction: jest.Mock;
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
    rolesHaveAction = jest.fn();
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
        { provide: RolePermissionsService, useValue: { rolesHaveAction } },
      ],
    }).compile();

    service = moduleRef.get(MeterService);
    // findOneSubMeter (called at the end of a successful update) re-queries and maps the response —
    // stub it directly so these tests stay focused on the authorization decision, not the response shape.
    jest.spyOn(service, 'findOneSubMeter').mockResolvedValue({ id: 55 } as any);
  });

  /** Models rolesHaveAction's real union semantics: true iff ANY of the given roles grants the code. */
  function grantsByRole(grants: Record<number, string[]>) {
    rolesHaveAction.mockImplementation((roleIds: number[], code: string) =>
      Promise.resolve(roleIds.some((roleId) => (grants[roleId] ?? []).includes(code))),
    );
  }

  it('a role holding ONLY METER_MAPPING can change unitId alone (the one field it actually covers)', async () => {
    grantsByRole({ 3: ['METER_MAPPING'] });

    await expect(service.updateSubMeter(55, { unitId: 42 } as any, 7, [3])).resolves.toBeDefined();
    expect(rolesHaveAction).not.toHaveBeenCalledWith([3], 'METER_INVENTORY_EDIT', 7);
  });

  it('a role holding ONLY METER_MAPPING is REJECTED when the request also changes a non-mapping field (the confirmed security fix)', async () => {
    grantsByRole({ 3: ['METER_MAPPING'] });

    await expect(
      service.updateSubMeter(55, { unitId: 42, serialNumber: 'SMT-NEW-001' } as any, 7, [3]),
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
    grantsByRole({ 3: ['METER_MAPPING'] });

    await expect(service.updateSubMeter(55, { [field]: value } as any, 7, [3])).rejects.toThrow(ForbiddenException);
  });

  it('a role holding METER_INVENTORY_EDIT can change every field, including non-mapping ones (unchanged, full access preserved)', async () => {
    grantsByRole({ 3: ['METER_INVENTORY_EDIT'] });

    await expect(
      service.updateSubMeter(55, { unitId: 42, serialNumber: 'SMT-NEW-001', floor: 5 } as any, 7, [3]),
    ).resolves.toBeDefined();
    expect(subMetersRepo.save).toHaveBeenCalled();
  });

  it('a role holding BOTH codes can change every field (METER_INVENTORY_EDIT alone is sufficient)', async () => {
    grantsByRole({ 3: ['METER_INVENTORY_EDIT', 'METER_MAPPING'] });

    await expect(
      service.updateSubMeter(55, { serialNumber: 'SMT-NEW-001' } as any, 7, [3]),
    ).resolves.toBeDefined();
  });

  it('no actorRoleIds resolved (undefined) is treated as no grant — rejected for non-mapping fields', async () => {
    await expect(
      service.updateSubMeter(55, { serialNumber: 'SMT-NEW-001' } as any, 7, undefined),
    ).rejects.toThrow(ForbiddenException);
    expect(rolesHaveAction).not.toHaveBeenCalled();
  });

  it('an actor with an EMPTY live role set is treated as no grant — rejected, and the permission lookup is never even made', async () => {
    await expect(
      service.updateSubMeter(55, { serialNumber: 'SMT-NEW-001' } as any, 7, []),
    ).rejects.toThrow(ForbiddenException);
    expect(rolesHaveAction).not.toHaveBeenCalled();
    expect(subMetersRepo.save).not.toHaveBeenCalled();
  });

  it('a mapping-only request (unitId: null, unmapping) does not require METER_INVENTORY_EDIT', async () => {
    grantsByRole({ 3: ['METER_MAPPING'] });

    await expect(service.updateSubMeter(55, { unitId: null } as any, 7, [3])).resolves.toBeDefined();
  });

  it("METER_INVENTORY_EDIT granted ONLY by the actor's own inline policy allows non-mapping fields — keyed by the actor id, and only that actor's", async () => {
    rolesHaveAction.mockImplementation((_roleIds: number[], code: string, userId?: number) =>
      Promise.resolve(userId === 7 && code === 'METER_INVENTORY_EDIT'),
    );

    await expect(service.updateSubMeter(55, { serialNumber: 'SMT-NEW-001' } as any, 7, [3])).resolves.toBeDefined();
    await expect(service.updateSubMeter(55, { serialNumber: 'SMT-NEW-002' } as any, 8, [3])).rejects.toThrow(ForbiddenException);
  });

  describe('multi-role actor (live role set)', () => {
    it('METER_INVENTORY_EDIT held ONLY through a SECONDARY role still allows non-mapping fields — and the whole role set is checked in ONE call', async () => {
      // Role 3 (primary) only maps; role 9 (secondary) is the one that grants full edit.
      grantsByRole({ 3: ['METER_MAPPING'], 9: ['METER_INVENTORY_EDIT'] });

      await expect(
        service.updateSubMeter(55, { serialNumber: 'SMT-NEW-001' } as any, 7, [3, 9]),
      ).resolves.toBeDefined();

      expect(rolesHaveAction).toHaveBeenCalledTimes(1);
      expect(rolesHaveAction).toHaveBeenCalledWith([3, 9], 'METER_INVENTORY_EDIT', 7);
      expect(subMetersRepo.save).toHaveBeenCalled();
    });

    it('a role that lacks the code never removes it from the actor — order of the roles is irrelevant', async () => {
      grantsByRole({ 3: ['METER_INVENTORY_EDIT'], 9: ['METER_MAPPING'] });

      await expect(service.updateSubMeter(55, { floor: 6 } as any, 7, [9, 3])).resolves.toBeDefined();
      await expect(service.updateSubMeter(55, { floor: 6 } as any, 7, [3, 9])).resolves.toBeDefined();
    });

    it('is REJECTED for a non-mapping field when NO role in the set holds METER_INVENTORY_EDIT (METER_MAPPING and others never combine into it)', async () => {
      grantsByRole({ 3: ['METER_MAPPING'], 9: ['METER_VIEW', 'METER_CREATE'] });

      await expect(
        service.updateSubMeter(55, { meterMake: 'Sensus' } as any, 7, [3, 9]),
      ).rejects.toThrow(ForbiddenException);
      expect(subMetersRepo.save).not.toHaveBeenCalled();
    });

    it('a mapping-only change by a multi-role actor needs no METER_INVENTORY_EDIT lookup at all', async () => {
      grantsByRole({ 3: ['METER_MAPPING'] });

      await expect(service.updateSubMeter(55, { unitId: 42 } as any, 7, [3, 9])).resolves.toBeDefined();
      expect(rolesHaveAction).not.toHaveBeenCalled();
    });
  });
});

// The controller is the seam where the principal becomes the service's actor argument — it must hand
// over the LIVE role set (principal.roleIds), never a single role id read off the JWT claim.
describe('MeterController.updateSubMeter — passes the actor\'s live role set', () => {
  it('forwards principal.roleIds (every current role), not the singular roleId', async () => {
    const updateSubMeter = jest.fn().mockResolvedValue({ id: 55 });
    const controller = new MeterController({ updateSubMeter } as unknown as MeterService);

    await controller.updateSubMeter(
      55,
      { unitId: 42 } as any,
      { sub: 7, email: 'ops@ccb.local', roleId: 3, roleName: 'OPERATIONS', roleIds: [3, 9], roleNames: ['OPERATIONS', 'FINANCE'], type: 'staff' },
    );

    expect(updateSubMeter).toHaveBeenCalledWith(55, { unitId: 42 }, 7, [3, 9]);
  });

  it('a principal with no resolved roles reaches the service with none — which then denies', async () => {
    const updateSubMeter = jest.fn().mockResolvedValue({ id: 55 });
    const controller = new MeterController({ updateSubMeter } as unknown as MeterService);

    await controller.updateSubMeter(55, { unitId: 42 } as any, undefined);

    expect(updateSubMeter).toHaveBeenCalledWith(55, { unitId: 42 }, undefined, undefined);
  });
});

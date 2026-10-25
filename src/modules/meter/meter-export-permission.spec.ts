import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { MeterController } from './meter.controller';

// RBAC cleanup audit finding: METER_EXPORT is a real, seeded, Policy-attachable Action code (METER
// resource) that previously gated nothing — both export routes only ever checked METER_VIEW/
// METER_INVENTORY_EXPORT, so a Policy granting a role ONLY METER_EXPORT (confirmed via a real,
// pre-existing custom Policy in the dev database, not a hypothetical) could never actually export.
// Fix is additive-only: METER_EXPORT was OR'd into both decorators, taking nothing away from
// existing METER_VIEW/METER_INVENTORY_EXPORT holders. This suite proves it against the REAL
// @Permission metadata and the REAL PermissionGuard, not a hand-copied assumption.
describe('Meter export routes — METER_EXPORT wired to a real guard (previously inert)', () => {
  let guard: PermissionGuard;
  let roleHasAction: jest.Mock;

  beforeEach(async () => {
    roleHasAction = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: { roleHasAction } }],
    }).compile();
    guard = moduleRef.get(PermissionGuard);
  });

  function requiredCodesFor(methodName: string): string[] {
    const codes = Reflect.getMetadata(PERMISSION_KEY, (MeterController.prototype as any)[methodName]);
    expect(codes).toBeDefined();
    return codes as string[];
  }

  function mockContext(methodName: string): ExecutionContext {
    const handler = (MeterController.prototype as any)[methodName];
    return {
      getHandler: () => handler,
      getClass: () => MeterController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 1, roleId: 3, roleName: 'TEST_ROLE', type: 'staff' } }) }),
    } as unknown as ExecutionContext;
  }

  async function grantOnly(code: string) {
    roleHasAction.mockImplementation((_roleId: number, c: string) => Promise.resolve(c === code));
  }

  it.each(['exportMasterMeters', 'exportSubMeters'])('%s requires METER_VIEW, METER_INVENTORY_EXPORT or METER_EXPORT', (methodName) => {
    expect(requiredCodesFor(methodName)).toEqual(
      expect.arrayContaining(['METER_VIEW', 'METER_INVENTORY_EXPORT', 'METER_EXPORT']),
    );
  });

  it.each(['exportMasterMeters', 'exportSubMeters'])(
    'a role holding ONLY METER_EXPORT can now call %s (the actual fix — previously always rejected)',
    async (methodName) => {
      await grantOnly('METER_EXPORT');
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);
    },
  );

  it.each(['exportMasterMeters', 'exportSubMeters'])(
    'a role holding ONLY METER_VIEW can still call %s (unchanged — nothing taken away)',
    async (methodName) => {
      await grantOnly('METER_VIEW');
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);
    },
  );

  it.each(['exportMasterMeters', 'exportSubMeters'])(
    'a role holding ONLY METER_INVENTORY_EXPORT can still call %s (unchanged — nothing taken away)',
    async (methodName) => {
      await grantOnly('METER_INVENTORY_EXPORT');
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);
    },
  );

  it.each(['exportMasterMeters', 'exportSubMeters'])(
    'a role holding none of the three is still rejected for %s',
    async (methodName) => {
      await grantOnly('METER_CREATE');
      expect(await guard.canActivate(mockContext(methodName))).toBe(false);
    },
  );
});

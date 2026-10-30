import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { AttributeController } from './attribute.controller';
import { AttributeService } from './attribute.service';
import { Attribute, AttributeScope, AttributeValueType } from './entities/attribute.entity';
import { AuditService } from '../../audit/audit.service';
import { RedisService } from '../../redis/redis.service';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';

// Isolated tests for AttributeService.update's actor handling. The actor is identified by their LIVE
// role set — principal.roleNames/roleIds, resolved per request from user_roles by JwtStrategy, never a
// role claim from the JWT: editing a SYSTEM-scope ("General") attribute requires SUPER_ADMIN among the
// actor's role NAMES (so SUPER_ADMIN held as a secondary role counts), and every other permission check
// asks rolesHaveAction over ALL of the actor's role IDS (a code granted by any one role is enough).
// rolesHaveAction mocks below model that union; only the repositories/collaborators are mocked.
describe('AttributeService.update — actor roles', () => {
  let service: AttributeService;
  let attributesRepo: { findOne: jest.Mock; save: jest.Mock };
  let rolesHaveAction: jest.Mock;
  let redis: { del: jest.Mock };
  let audit: { record: jest.Mock };

  const FINANCE = 5;
  const SUPER_ADMIN = 1;
  const REGISTRAR = 9;

  const systemAttribute = (): Partial<Attribute> => ({
    id: 1,
    scope: AttributeScope.SYSTEM,
    key: 'SESSION_TIMEOUT_MINUTES',
    label: 'Session Timeout (minutes)',
    valueType: AttributeValueType.NUMBER,
    value: '30',
    customerValue: null,
    editable: true,
  });

  const moduleAttribute = (): Partial<Attribute> => ({
    id: 2,
    scope: AttributeScope.MODULE,
    key: 'REPORTING_MANAGER_MANDATORY',
    label: 'Reporting Manager Mandatory',
    valueType: AttributeValueType.BOOLEAN,
    value: 'false',
    customerValue: null,
    editable: true,
  });

  const ocrAttribute = (): Partial<Attribute> => ({
    id: 3,
    scope: AttributeScope.MODULE,
    key: 'OCR_DATA_ENTRY_ENABLED',
    label: 'OCR-Based Data Entry',
    valueType: AttributeValueType.BOOLEAN,
    value: 'true',
    customerValue: null,
    editable: true,
  });

  beforeEach(async () => {
    attributesRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    rolesHaveAction = jest.fn().mockResolvedValue(false);
    redis = { del: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttributeService,
        { provide: getRepositoryToken(Attribute), useValue: attributesRepo },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: RolePermissionsService, useValue: { rolesHaveAction } },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(AttributeService);
  });

  /** Models rolesHaveAction's real semantics: true iff ANY of the given roles grants the code. */
  function grantsByRole(grants: Record<number, string[]>) {
    rolesHaveAction.mockImplementation((roleIds: number[], code: string) =>
      Promise.resolve(roleIds.some((roleId) => (grants[roleId] ?? []).includes(code))),
    );
  }

  describe('SYSTEM-scope attributes require SUPER_ADMIN among the actor\'s live role names', () => {
    beforeEach(() => {
      attributesRepo.findOne.mockResolvedValue(systemAttribute());
    });

    it('SUPER_ADMIN as the actor\'s only role may edit (given EDIT_ATTRIBUTE)', async () => {
      grantsByRole({ [SUPER_ADMIN]: ['EDIT_ATTRIBUTE'] });

      await expect(service.update(1, { value: '60' }, 7, ['SUPER_ADMIN'], [SUPER_ADMIN])).resolves.toBeDefined();
      expect(attributesRepo.save).toHaveBeenCalled();
    });

    it('SUPER_ADMIN held as a SECONDARY role is enough — a multi-role actor [FINANCE, SUPER_ADMIN] may edit', async () => {
      grantsByRole({ [FINANCE]: [], [SUPER_ADMIN]: ['EDIT_ATTRIBUTE'] });

      await expect(
        service.update(1, { value: '60' }, 7, ['FINANCE', 'SUPER_ADMIN'], [FINANCE, SUPER_ADMIN]),
      ).resolves.toBeDefined();
      expect(rolesHaveAction).toHaveBeenCalledWith([FINANCE, SUPER_ADMIN], 'EDIT_ATTRIBUTE', 7);
      expect(attributesRepo.save).toHaveBeenCalled();
    });

    it('an actor with no SUPER_ADMIN among their roles is refused even when a role holds EDIT_ATTRIBUTE — and no permission lookup is even made', async () => {
      grantsByRole({ [FINANCE]: ['EDIT_ATTRIBUTE'], [REGISTRAR]: ['EDIT_ATTRIBUTE'] });

      await expect(
        service.update(1, { value: '60' }, 7, ['FINANCE', 'REGISTRAR'], [FINANCE, REGISTRAR]),
      ).rejects.toThrow(new ForbiddenException('Only Super Admin can edit General Attributes'));
      expect(rolesHaveAction).not.toHaveBeenCalled();
      expect(attributesRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      ['no role names at all (undefined)', undefined],
      ['an empty role-name list', []],
    ])('%s is refused', async (_label, roleNames) => {
      grantsByRole({ [SUPER_ADMIN]: ['EDIT_ATTRIBUTE'] });

      await expect(service.update(1, { value: '60' }, 7, roleNames as string[] | undefined, [SUPER_ADMIN])).rejects.toThrow(
        'Only Super Admin can edit General Attributes',
      );
      expect(attributesRepo.save).not.toHaveBeenCalled();
    });

    it('being SUPER_ADMIN is necessary but not sufficient: without EDIT_ATTRIBUTE on any role the edit is still refused', async () => {
      grantsByRole({}); // SUPER_ADMIN name present, but no role grants EDIT_ATTRIBUTE

      await expect(
        service.update(1, { value: '60' }, 7, ['SUPER_ADMIN'], [SUPER_ADMIN]),
      ).rejects.toThrow('You do not have permission to edit "Session Timeout (minutes)"');
      expect(attributesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('EDIT_ATTRIBUTE may be held through ANY of the actor\'s roles', () => {
    beforeEach(() => {
      attributesRepo.findOne.mockResolvedValue(moduleAttribute());
    });

    it('a code granted only by a SECONDARY role is honoured — the whole role set is checked in one call', async () => {
      grantsByRole({ [FINANCE]: [], [REGISTRAR]: ['EDIT_ATTRIBUTE'] });

      await expect(service.update(2, { value: 'true' }, 7, ['FINANCE', 'REGISTRAR'], [FINANCE, REGISTRAR])).resolves.toBeDefined();

      expect(rolesHaveAction).toHaveBeenCalledTimes(1);
      expect(rolesHaveAction).toHaveBeenCalledWith([FINANCE, REGISTRAR], 'EDIT_ATTRIBUTE', 7);
      expect(attributesRepo.save).toHaveBeenCalled();
    });

    it('a role that lacks the code never takes it away from another role of the actor', async () => {
      grantsByRole({ [FINANCE]: ['EDIT_ATTRIBUTE'] }); // REGISTRAR grants nothing

      await expect(service.update(2, { value: 'true' }, 7, ['REGISTRAR', 'FINANCE'], [REGISTRAR, FINANCE])).resolves.toBeDefined();
      await expect(service.update(2, { value: 'true' }, 7, ['FINANCE', 'REGISTRAR'], [FINANCE, REGISTRAR])).resolves.toBeDefined();
    });

    it('no role holding EDIT_ATTRIBUTE is refused with the per-attribute message and nothing is written', async () => {
      grantsByRole({ [FINANCE]: ['VIEW_ATTRIBUTE'], [REGISTRAR]: ['CREATE_REGISTRATION_REQUEST'] });

      await expect(
        service.update(2, { value: 'true' }, 7, ['FINANCE', 'REGISTRAR'], [FINANCE, REGISTRAR]),
      ).rejects.toThrow(new ForbiddenException('You do not have permission to edit "Reporting Manager Mandatory"'));
      expect(attributesRepo.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each([
      ['no role ids at all (undefined)', undefined],
      ['an empty live role set', []],
    ])('%s is refused without any permission lookup', async (_label, roleIds) => {
      grantsByRole({ [FINANCE]: ['EDIT_ATTRIBUTE'] });

      await expect(service.update(2, { value: 'true' }, 7, ['FINANCE'], roleIds as number[] | undefined)).rejects.toThrow(
        ForbiddenException,
      );
      expect(rolesHaveAction).not.toHaveBeenCalled();
      expect(attributesRepo.save).not.toHaveBeenCalled();
    });

    it('a successful edit is audited against the real actor id', async () => {
      grantsByRole({ [FINANCE]: ['EDIT_ATTRIBUTE'] });

      await service.update(2, { value: 'true' }, 7, ['FINANCE'], [FINANCE]);

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ moduleName: 'attributes', entityId: 2, action: 'UPDATE', performedBy: 7 }));
      expect(redis.del).toHaveBeenCalledWith('attribute:REPORTING_MANAGER_MANDATORY');
    });

    it("EDIT_ATTRIBUTE granted ONLY by the actor's own inline policy counts — the check is keyed by the actor id, and only that actor's", async () => {
      // rolesHaveAction(roleIds, code, userId): true iff a role OR that user's inline policy grants it.
      rolesHaveAction.mockImplementation((_roleIds: number[], code: string, userId?: number) =>
        Promise.resolve(userId === 7 && code === 'EDIT_ATTRIBUTE'),
      );

      await expect(service.update(2, { value: 'true' }, 7, ['FINANCE'], [FINANCE])).resolves.toBeDefined();
      await expect(service.update(2, { value: 'true' }, 8, ['FINANCE'], [FINANCE])).rejects.toThrow(ForbiddenException);
    });
  });

  describe('OCR_DATA_ENTRY_ENABLED — the registration-wizard alternate codes, also across roles', () => {
    beforeEach(() => {
      attributesRepo.findOne.mockResolvedValue(ocrAttribute());
    });

    it('CREATE_REGISTRATION_REQUEST held only by a SECONDARY role lets the actor flip it (no EDIT_ATTRIBUTE anywhere)', async () => {
      grantsByRole({ [FINANCE]: [], [REGISTRAR]: ['CREATE_REGISTRATION_REQUEST'] });

      await expect(service.update(3, { value: 'false' }, 7, ['FINANCE', 'REGISTRAR'], [FINANCE, REGISTRAR])).resolves.toBeDefined();

      expect(rolesHaveAction).toHaveBeenCalledWith([FINANCE, REGISTRAR], 'EDIT_ATTRIBUTE', 7);
      expect(rolesHaveAction).toHaveBeenCalledWith([FINANCE, REGISTRAR], 'CREATE_REGISTRATION_REQUEST', 7);
      expect(rolesHaveAction).toHaveBeenCalledWith([FINANCE, REGISTRAR], 'EDIT_REGISTRATION_REQUEST', 7);
      expect(attributesRepo.save).toHaveBeenCalled();
    });

    it('EDIT_REGISTRATION_REQUEST held through any role works as well', async () => {
      grantsByRole({ [REGISTRAR]: ['EDIT_REGISTRATION_REQUEST'] });

      await expect(service.update(3, { value: 'false' }, 7, ['REGISTRAR'], [REGISTRAR])).resolves.toBeDefined();
    });

    it('no role holding EDIT_ATTRIBUTE or either alternate code is refused', async () => {
      grantsByRole({ [FINANCE]: ['VIEW_REGISTRATION_REQUESTS'] });

      await expect(service.update(3, { value: 'false' }, 7, ['FINANCE'], [FINANCE])).rejects.toThrow(ForbiddenException);
      expect(attributesRepo.save).not.toHaveBeenCalled();
    });

    it('the alternate codes apply to THIS attribute only — an ordinary attribute still needs EDIT_ATTRIBUTE', async () => {
      attributesRepo.findOne.mockResolvedValue(moduleAttribute());
      grantsByRole({ [REGISTRAR]: ['CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST'] });

      await expect(service.update(2, { value: 'true' }, 7, ['REGISTRAR'], [REGISTRAR])).rejects.toThrow(ForbiddenException);
    });
  });
});

// The controller is the seam where the principal becomes the service's actor arguments — it must hand
// over the LIVE role names and ids (principal.roleNames / roleIds), never the singular claims.
describe('AttributeController.update — passes the actor\'s live role set', () => {
  it('forwards principal.roleNames and principal.roleIds (every current role), not the singular roleName/roleId', async () => {
    const update = jest.fn().mockResolvedValue({ id: 1 });
    const controller = new AttributeController({ update } as unknown as AttributeService);

    await controller.update(
      1,
      { value: '60' },
      { sub: 7, email: 'root@ccb.local', roleId: 5, roleName: 'FINANCE', roleIds: [5, 1], roleNames: ['FINANCE', 'SUPER_ADMIN'], type: 'staff' },
    );

    expect(update).toHaveBeenCalledWith(1, { value: '60' }, 7, ['FINANCE', 'SUPER_ADMIN'], [5, 1]);
  });

  it('a principal with no resolved roles reaches the service with none — which then denies', async () => {
    const update = jest.fn().mockResolvedValue({ id: 1 });
    const controller = new AttributeController({ update } as unknown as AttributeService);

    await controller.update(1, { value: '60' }, undefined);

    expect(update).toHaveBeenCalledWith(1, { value: '60' }, undefined, undefined, undefined);
  });
});

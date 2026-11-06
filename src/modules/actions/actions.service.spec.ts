import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { Action } from './entities/action.entity';
import { Screen } from '../screens/entities/screen.entity';
import { AuditService } from '../../audit/audit.service';
import { ACTIONS } from '../../bootstrap/seed-data';
import { ACTION_TO_RESOURCE_CODE } from '../iam/resource-catalog';

// Isolated unit tests for ActionsService: its audit trail (create/update/remove on the Action taxonomy
// itself were never audited) and the protection of SYSTEM actions — every seeded Action plus every code the
// IAM Resource catalog maps. Guards, the sidebar and the Policy editor key off those exact codes, so a system
// action may have its description or ordering edited but can never be renamed, deactivated or deleted: doing
// so would silently break the authorization it backs. ensureCriticalDefaults' boot-time backfill path is
// deliberately untouched/unaudited (no real actor, runs on every app boot) — only the real admin-triggered
// CRUD methods gained audit calls, verified here.
describe('ActionsService audit trail', () => {
  let service: ActionsService;
  let auditService: { record: jest.Mock };
  let actionRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; softRemove: jest.Mock };
  let screenRepo: { findOne: jest.Mock };

  // A custom (non-system) action: free to rename, deactivate and delete.
  const EXISTING_ACTION = { id: 42, name: 'View Quarterly Digest', code: 'VIEW_QUARTERLY_DIGEST', screenId: 10, parentActionId: null } as Action;

  beforeEach(async () => {
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    actionRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data) => data),
      softRemove: jest.fn().mockResolvedValue(undefined),
    };
    screenRepo = { findOne: jest.fn().mockResolvedValue({ id: 10 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ActionsService,
        { provide: getRepositoryToken(Action), useValue: actionRepo },
        { provide: getRepositoryToken(Screen), useValue: screenRepo },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(ActionsService);
  });

  describe('create', () => {
    it('saves the new action and records a CREATE audit entry with the real actor', async () => {
      actionRepo.findOne.mockResolvedValueOnce(null); // uniqueness check passes
      const saved = { ...EXISTING_ACTION, id: 99 };
      actionRepo.save.mockResolvedValue(saved);

      const result = await service.create({ name: 'View Quarterly Digest', code: 'VIEW_QUARTERLY_DIGEST', screenId: 10 } as any, 3);

      expect(result).toEqual(saved);
      expect(auditService.record).toHaveBeenCalledWith({
        moduleName: 'actions',
        entityId: 99,
        action: 'CREATE',
        newValue: saved,
        performedBy: 3,
      });
    });

    it('never audits when the action already exists', async () => {
      actionRepo.findOne.mockResolvedValueOnce(EXISTING_ACTION);

      await expect(
        service.create({ name: 'View Quarterly Digest', code: 'VIEW_QUARTERLY_DIGEST', screenId: 10 } as any, 3),
      ).rejects.toThrow(ConflictException);

      expect(auditService.record).not.toHaveBeenCalled();
      expect(actionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('records an UPDATE audit entry with both old and new values', async () => {
      actionRepo.findOne.mockResolvedValue({ ...EXISTING_ACTION });
      const saved = { ...EXISTING_ACTION, name: 'View Quarterly Digest (renamed)' };
      actionRepo.save.mockResolvedValue(saved);

      const result = await service.update(42, { name: 'View Quarterly Digest (renamed)' } as any, 5);

      expect(result).toEqual(saved);
      expect(auditService.record).toHaveBeenCalledWith({
        moduleName: 'actions',
        entityId: 42,
        action: 'UPDATE',
        oldValue: expect.objectContaining({ name: 'View Quarterly Digest' }),
        newValue: saved,
        performedBy: 5,
      });
    });

    it('never audits when the parent/screen validation rejects the update', async () => {
      actionRepo.findOne.mockResolvedValue({ ...EXISTING_ACTION });

      await expect(service.update(42, { parentActionId: 42 } as any, 5)).rejects.toThrow(ConflictException);

      expect(auditService.record).not.toHaveBeenCalled();
      expect(actionRepo.save).not.toHaveBeenCalled();
    });

    it('a custom action can be renamed and deactivated freely', async () => {
      actionRepo.findOne.mockResolvedValue({ ...EXISTING_ACTION });
      actionRepo.save.mockImplementation(async (a) => a);

      await expect(service.update(42, { code: 'VIEW_QUARTERLY_DIGEST_V2', isActive: false } as any, 5)).resolves.toMatchObject({
        code: 'VIEW_QUARTERLY_DIGEST_V2',
        isActive: false,
      });
    });
  });

  describe('remove', () => {
    it('soft-removes the action and records a DELETE audit entry', async () => {
      actionRepo.findOne.mockResolvedValue({ ...EXISTING_ACTION });

      const result = await service.remove(42, 8);

      expect(result).toEqual({ message: 'Action deleted successfully' });
      expect(actionRepo.softRemove).toHaveBeenCalledWith({ ...EXISTING_ACTION });
      expect(auditService.record).toHaveBeenCalledWith({
        moduleName: 'actions',
        entityId: 42,
        action: 'DELETE',
        oldValue: { ...EXISTING_ACTION },
        performedBy: 8,
      });
    });

    it('never audits when the action does not exist', async () => {
      actionRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(999, 8)).rejects.toThrow(NotFoundException);

      expect(auditService.record).not.toHaveBeenCalled();
      expect(actionRepo.softRemove).not.toHaveBeenCalled();
    });
  });

  describe('system actions are protected — authorization depends on their exact code', () => {
    // VIEW_CUSTOMER is seeded; IMPORT_CENTER_VIEW is one a guard checks too. Both must be system actions.
    const system = (code: string, name = 'Some seeded name') => ({ id: 7, name, code, screenId: 10, parentActionId: null, isActive: true }) as Action;

    it('the protected set is every seeded action code plus every code the Resource catalog maps — nothing less', () => {
      const expected = new Set([...ACTIONS.map((a) => a.code), ...Object.keys(ACTION_TO_RESOURCE_CODE)]);
      expect(expected.size).toBeGreaterThan(50);
      expect(expected.has('VIEW_CUSTOMER')).toBe(true);
      expect(expected.has('IMPORT_CENTER_VIEW')).toBe(true);
    });

    it.each(['VIEW_CUSTOMER', 'CREATE_USER', 'EDIT_USER', 'DELETE_USER', 'VIEW_ROLE', 'RESET_USER_PASSWORD', 'IMPORT_CENTER_VIEW'])(
      '%s cannot be renamed (code or name), deactivated or deleted — 409, nothing saved, nothing audited',
      async (code) => {
        actionRepo.findOne.mockResolvedValue(system(code));

        await expect(service.update(7, { code: `${code}_X` } as any, 5)).rejects.toThrow(ConflictException);
        await expect(service.update(7, { name: 'Renamed' } as any, 5)).rejects.toThrow(ConflictException);
        await expect(service.update(7, { isActive: false } as any, 5)).rejects.toThrow(ConflictException);
        await expect(service.remove(7, 5)).rejects.toThrow(ConflictException);

        expect(actionRepo.save).not.toHaveBeenCalled();
        expect(actionRepo.softRemove).not.toHaveBeenCalled();
        expect(auditService.record).not.toHaveBeenCalled();
      },
    );

    it('the refusal names the code and says why', async () => {
      actionRepo.findOne.mockResolvedValue(system('VIEW_CUSTOMER'));

      await expect(service.update(7, { isActive: false } as any, 5)).rejects.toThrow(
        '"VIEW_CUSTOMER" is a system permission — it cannot be renamed or deactivated, because authorization depends on it.',
      );
      await expect(service.remove(7, 5)).rejects.toThrow(
        '"VIEW_CUSTOMER" is a system permission and cannot be deleted, because authorization depends on it.',
      );
    });

    it('a system action can still have its description edited, be re-activated, or be re-saved with its own code and name unchanged', async () => {
      actionRepo.findOne.mockResolvedValue(system('VIEW_CUSTOMER', 'View Customer'));
      actionRepo.save.mockImplementation(async (a) => a);

      await expect(service.update(7, { description: 'Reads the customer list' } as any, 5)).resolves.toMatchObject({
        description: 'Reads the customer list',
      });
      await expect(service.update(7, { code: 'VIEW_CUSTOMER', name: 'View Customer', isActive: true } as any, 5)).resolves.toBeDefined();
      expect(auditService.record).toHaveBeenCalledTimes(2);
    });
  });
});

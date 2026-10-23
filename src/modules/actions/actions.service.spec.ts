import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { Action } from './entities/action.entity';
import { Screen } from '../screens/entities/screen.entity';
import { AuditService } from '../../audit/audit.service';

// Isolated unit tests for ActionsService's new audit trail (Phase 0 — create/update/remove on the
// Action taxonomy itself were never audited). ensureCriticalDefaults' boot-time backfill path is
// deliberately untouched/unaudited (no real actor, runs on every app boot) — only the real
// admin-triggered CRUD methods gained audit calls, verified here.
describe('ActionsService audit trail', () => {
  let service: ActionsService;
  let auditService: { record: jest.Mock };
  let actionRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; softRemove: jest.Mock };
  let screenRepo: { findOne: jest.Mock };

  const EXISTING_ACTION = { id: 42, name: 'View Customer', code: 'VIEW_CUSTOMER', screenId: 10, parentActionId: null } as Action;

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

      const result = await service.create({ name: 'View Customer', code: 'VIEW_CUSTOMER', screenId: 10 } as any, 3);

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
        service.create({ name: 'View Customer', code: 'VIEW_CUSTOMER', screenId: 10 } as any, 3),
      ).rejects.toThrow(ConflictException);

      expect(auditService.record).not.toHaveBeenCalled();
      expect(actionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('records an UPDATE audit entry with both old and new values', async () => {
      actionRepo.findOne.mockResolvedValue({ ...EXISTING_ACTION });
      const saved = { ...EXISTING_ACTION, name: 'View Customer (renamed)' };
      actionRepo.save.mockResolvedValue(saved);

      const result = await service.update(42, { name: 'View Customer (renamed)' } as any, 5);

      expect(result).toEqual(saved);
      expect(auditService.record).toHaveBeenCalledWith({
        moduleName: 'actions',
        entityId: 42,
        action: 'UPDATE',
        oldValue: expect.objectContaining({ name: 'View Customer' }),
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
});

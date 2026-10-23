import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRoleService } from './user-role.service';
import { UserRole } from './entities/user-role.entity';
import { AuditService } from '../../audit/audit.service';

// Isolated unit tests for UserRoleService.setPrimaryRole's new audit trail (Phase 0 — assigning or
// reassigning a user's role left no audit record at all before this). Covers both the direct-repo
// path (no transaction manager passed) and the shared-manager path UserService.create/update
// actually use, confirming the audit insert goes through the SAME manager when one is supplied —
// so it commits/rolls back atomically with the caller's own User row, never independently.
describe('UserRoleService.setPrimaryRole audit trail', () => {
  let service: UserRoleService;
  let auditService: { record: jest.Mock };
  let userRolesRepo: { findOne: jest.Mock; delete: jest.Mock; save: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    userRolesRepo = {
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((data) => data),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserRoleService,
        { provide: getRepositoryToken(UserRole), useValue: userRolesRepo },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(UserRoleService);
  });

  it('records the previous roleId as oldValue and the new one as newValue, with the real actor', async () => {
    userRolesRepo.findOne.mockResolvedValue({ id: 1, userId: 55, roleId: 3 });

    await service.setPrimaryRole(55, 7, undefined, 11);

    expect(userRolesRepo.delete).toHaveBeenCalledWith({ userId: 55 });
    expect(userRolesRepo.save).toHaveBeenCalledWith({ userId: 55, roleId: 7 });
    expect(auditService.record).toHaveBeenCalledWith(
      {
        moduleName: 'user_roles',
        entityId: 55,
        action: 'ASSIGN_ROLE',
        oldValue: { roleId: 3 },
        newValue: { roleId: 7 },
        performedBy: 11,
      },
      undefined,
    );
  });

  it('records oldValue roleId: null for a user with no prior role row (first-ever assignment)', async () => {
    userRolesRepo.findOne.mockResolvedValue(null);

    await service.setPrimaryRole(56, 7, undefined, 11);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: { roleId: null } }),
      undefined,
    );
  });

  it('threads the SAME transaction manager through to both the role write and the audit insert', async () => {
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 1, userId: 55, roleId: 3 }),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((data: unknown) => data),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await service.setPrimaryRole(55, 7, manager as any, 11);

    expect(manager.getRepository).toHaveBeenCalledWith(UserRole);
    expect(managerRepo.delete).toHaveBeenCalledWith({ userId: 55 });
    expect(auditService.record).toHaveBeenCalledWith(expect.any(Object), manager);
    // Confirms the plain injected repository (no manager) was never touched for this call.
    expect(userRolesRepo.delete).not.toHaveBeenCalled();
  });

  it('omitting actorId (boot-time seeding) still records an audit row with performedBy: null handled by AuditService itself', async () => {
    userRolesRepo.findOne.mockResolvedValue(null);

    await service.setPrimaryRole(1, 1, undefined, undefined);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ performedBy: undefined }),
      undefined,
    );
  });
});

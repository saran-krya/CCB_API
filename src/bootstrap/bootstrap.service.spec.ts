import { Logger } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';

// bcrypt at cost 12 is deliberately slow; this suite is about role seeding, not hashing.
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-password') }));

// Isolated tests for how BootstrapService gives the seeded Super Admin its role under the multi-role
// assignment model. The seed assigns SUPER_ADMIN through UserRoleService.addRolesToUser — additive and
// idempotent, so it can never strip a role someone has granted that account — and it only ever runs
// on a database that has no users at all. Every dependency is mocked; no database connection.
describe('BootstrapService — Super Admin role seeding', () => {
  let service: BootstrapService;
  let usersCount: jest.Mock;
  let dataSource: { getRepository: jest.Mock; transaction: jest.Mock };
  let config: { get: jest.Mock };
  let userRoleService: { addRolesToUser: jest.Mock; removeRoleFromUser: jest.Mock };
  let ensureSteps: Record<string, { ensureCriticalDefaults: jest.Mock }>;
  let iamService: { ensureResourceCatalog: jest.Mock; ensureAdminPolicyGrants: jest.Mock };
  let rolePermissionsService: { ensureAdminGrants: jest.Mock; ensureSuperAdminGrant: jest.Mock };
  const manager = { create: jest.fn(), save: jest.fn() };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    usersCount = jest.fn();
    dataSource = {
      getRepository: jest.fn().mockReturnValue({ count: usersCount }),
      transaction: jest.fn().mockImplementation((work: (m: unknown) => unknown) => work(manager)),
    };
    const values: Record<string, string> = { DEFAULT_ADMIN_PASSWORD: 'a-long-initial-password' };
    config = { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };
    userRoleService = {
      addRolesToUser: jest.fn().mockResolvedValue([]),
      removeRoleFromUser: jest.fn(),
    };
    const step = () => ({ ensureCriticalDefaults: jest.fn().mockResolvedValue(undefined) });
    ensureSteps = { lov: step(), attribute: step(), pModules: step(), subModules: step(), screens: step(), actions: step(), documentRules: step() };
    iamService = { ensureResourceCatalog: jest.fn().mockResolvedValue(undefined), ensureAdminPolicyGrants: jest.fn().mockResolvedValue(undefined) };
    rolePermissionsService = { ensureAdminGrants: jest.fn().mockResolvedValue(undefined), ensureSuperAdminGrant: jest.fn().mockResolvedValue(undefined) };

    manager.create.mockReset().mockImplementation((_entity: unknown, data: object) => ({ ...data }));
    manager.save.mockReset().mockImplementation(async (entity: object) => ({ ...entity, id: 41 }));

    service = new BootstrapService(
      dataSource as any,
      config as any,
      ensureSteps.lov as any,
      ensureSteps.attribute as any,
      ensureSteps.pModules as any,
      ensureSteps.subModules as any,
      ensureSteps.screens as any,
      ensureSteps.actions as any,
      rolePermissionsService as any,
      ensureSteps.documentRules as any,
      userRoleService as any,
      iamService as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('seedSuperAdmin', () => {
    const seed = (roleMap: Map<string, { id: number; roleName: string }>) => (service as any).seedSuperAdmin(manager, roleMap);

    it("assigns SUPER_ADMIN to the new admin through the additive addRolesToUser, inside the seed transaction's own manager, with no actor", async () => {
      await seed(new Map([['SUPER_ADMIN', { id: 2, roleName: 'SUPER_ADMIN' }]]));

      expect(userRoleService.addRolesToUser).toHaveBeenCalledTimes(1);
      expect(userRoleService.addRolesToUser).toHaveBeenCalledWith(41, [2], manager);
    });

    it('never revokes anything — the seed path has no way to strip a role someone else granted', async () => {
      await seed(new Map([['SUPER_ADMIN', { id: 2, roleName: 'SUPER_ADMIN' }]]));

      expect(userRoleService.removeRoleFromUser).not.toHaveBeenCalled();
    });

    it('fails the whole seed when the SUPER_ADMIN role was not created, before any user is written', async () => {
      await expect(seed(new Map())).rejects.toThrow('SUPER_ADMIN role was not created');

      expect(manager.save).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });
  });

  describe('when the role seeding runs', () => {
    it('never on a database that already has users — only the idempotent critical-default backfills run, and no role assignment is touched', async () => {
      usersCount.mockResolvedValue(3);

      await service.onApplicationBootstrap();

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
      expect(userRoleService.removeRoleFromUser).not.toHaveBeenCalled();
      expect(ensureSteps.lov.ensureCriticalDefaults).toHaveBeenCalledTimes(1);
    });

    it('on a fresh, user-less database it seeds once, inside a single transaction', async () => {
      usersCount.mockResolvedValue(0);
      const seed = jest.spyOn(service as any, 'seed').mockResolvedValue(undefined);

      await service.onApplicationBootstrap();

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(seed).toHaveBeenCalledTimes(1);
      expect(seed).toHaveBeenCalledWith(manager);
    });
  });
});

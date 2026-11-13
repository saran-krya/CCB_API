import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { BootstrapService } from './bootstrap.service';
import { SYSTEM_ACTOR } from '../common/security/actor';


// bcrypt at cost 12 is deliberately slow; this suite is about seeding, not hashing.
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-password') }));

// Isolated tests for how BootstrapService seeds the first Super Admin. The seed assigns SUPER_ADMIN through
// UserRoleService.addRolesToUser — additive and idempotent, so it can never strip a role someone has granted
// that account — acting as the SYSTEM actor (the one caller allowed to grant SUPER_ADMIN without a signed-in
// user), and it only ever runs on a database that has no users at all. The initial password comes from the
// environment, so it must meet the password policy and the account must be forced to replace it at first
// sign-in. Every dependency is mocked; no database connection.
describe('BootstrapService — Super Admin seeding', () => {
  let service: BootstrapService;
  let usersCount: jest.Mock;

  let dataSource: { getRepository: jest.Mock; transaction: jest.Mock };
  let config: { get: jest.Mock };
  let configValues: Record<string, string | undefined>;
  let userRoleService: { addRolesToUser: jest.Mock; removeRoleFromUser: jest.Mock };
  let ensureSteps: Record<string, { ensureCriticalDefaults: jest.Mock }>;
  let iamService: { ensureResourceCatalog: jest.Mock; ensureAdminPolicyGrants: jest.Mock };
  let rolePermissionsService: { ensureAdminGrants: jest.Mock };
  const manager = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };

  // A password that satisfies the policy (12+ characters, three character types, not one repeated character).
  const STRONG_PASSWORD = 'A-Long-Initial-Passw0rd!';
  const SUPER_ADMIN_ROLE = new Map([['SUPER_ADMIN', { id: 2, roleName: 'SUPER_ADMIN' }]]);

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
    configValues = { DEFAULT_ADMIN_PASSWORD: STRONG_PASSWORD };
    config = { get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback) };
    userRoleService = {
      addRolesToUser: jest.fn().mockResolvedValue([]),
      removeRoleFromUser: jest.fn(),
    };
    const step = () => ({ ensureCriticalDefaults: jest.fn().mockResolvedValue(undefined) });
    ensureSteps = { lov: step(), attribute: step(), pModules: step(), subModules: step(), screens: step(), actions: step(), documentRules: step() };
    iamService = { ensureResourceCatalog: jest.fn().mockResolvedValue(undefined), ensureAdminPolicyGrants: jest.fn().mockResolvedValue(undefined) };
    rolePermissionsService = { ensureAdminGrants: jest.fn().mockResolvedValue(undefined) };

    (bcrypt.hash as jest.Mock).mockClear();
    manager.create.mockReset().mockImplementation((_entity: unknown, data: object) => ({ ...data }));
    manager.save.mockReset().mockImplementation(async (entity: object) => ({ ...entity, id: 41 }));
    // The seed steps are find-or-create: "nothing there yet" is the fresh-database case these tests describe.
    manager.findOne.mockReset().mockResolvedValue(null);

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
    const seed = (roleMap: Map<string, { id: number; roleName: string }> = SUPER_ADMIN_ROLE) => (service as any).seedSuperAdmin(manager, roleMap);

    it("assigns SUPER_ADMIN to the new admin through the additive addRolesToUser, inside the seed transaction's own manager, acting as the SYSTEM actor", async () => {
      await seed();

      expect(userRoleService.addRolesToUser).toHaveBeenCalledTimes(1);
      expect(userRoleService.addRolesToUser).toHaveBeenCalledWith(41, [2], manager, SYSTEM_ACTOR);
    });

    it('never revokes anything — the seed path has no way to strip a role someone else granted', async () => {
      await seed();

      expect(userRoleService.removeRoleFromUser).not.toHaveBeenCalled();
    });

    it('fails the whole seed when the SUPER_ADMIN role was not created, before any user is written', async () => {
      await expect(seed(new Map())).rejects.toThrow('SUPER_ADMIN role was not created');

      expect(manager.save).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });

    describe('the initial password', () => {
      it('is hashed (bcrypt, cost 12) and only the HASH is stored — the raw password never reaches the User row', async () => {
        await seed();

        expect(bcrypt.hash).toHaveBeenCalledWith(STRONG_PASSWORD, 12);
        const [, userData] = manager.create.mock.calls[0];
        expect(userData.passwordHash).toBe('hashed-password');
        expect(JSON.stringify(userData)).not.toContain(STRONG_PASSWORD);
      });

      it('must be replaced at first sign-in — the seeded account is created with mustChangePassword = true', async () => {
        await seed();

        const [, userData] = manager.create.mock.calls[0];
        expect(userData).toMatchObject({ active: true, mustChangePassword: true });
        expect(userData.passwordUpdatedAt).toBeInstanceOf(Date);
      });

      it('is required: a missing or empty DEFAULT_ADMIN_PASSWORD fails the seed before anything is written', async () => {
        for (const value of [undefined, '']) {
          configValues.DEFAULT_ADMIN_PASSWORD = value;

          await expect(seed()).rejects.toThrow('DEFAULT_ADMIN_PASSWORD environment variable is required');
        }

        expect(manager.save).not.toHaveBeenCalled();
        expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
      });

      it.each([
        ['too short', 'Aa1!aaaa'],
        ['one character type only', 'aaaaaaaaaaaaaaaaaaaa'],
        ['two character types only (the old example value)', 'a-long-initial-password'],
        ['one repeated character', 'aaaaaaaaaaaaaaaa'],
      ])('a password that is %s is refused by the policy — nothing is written, nothing is hashed', async (_label, weak) => {
        configValues.DEFAULT_ADMIN_PASSWORD = weak;

        await expect(seed()).rejects.toThrow('DEFAULT_ADMIN_PASSWORD does not meet the password policy');

        expect(bcrypt.hash).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
        expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
      });

      it('the refusal says what is wrong but NEVER echoes the configured password', async () => {
        configValues.DEFAULT_ADMIN_PASSWORD = 'weakweakweakweak';

        const failure = await seed().then(
          () => new Error('seed unexpectedly succeeded'),
          (err: Error) => err,
        );

        expect(failure.message).toContain('3 of the 4 character types');
        expect(failure.message).not.toContain('weakweakweakweak');
      });
    });

    it('the admin identity comes from config: DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_NAME, with neutral defaults', async () => {
      await seed();
      let [, userData] = manager.create.mock.calls[0];
      expect(userData).toMatchObject({ email: 'admin@ccb.local', firstName: 'System', lastName: 'Administrator' });

      manager.create.mockClear();
      configValues.DEFAULT_ADMIN_EMAIL = 'root@example.test';
      configValues.DEFAULT_ADMIN_NAME = 'Grace Hopper';
      await seed();
      [, userData] = manager.create.mock.calls[0];
      expect(userData).toMatchObject({ email: 'root@example.test', firstName: 'Grace', lastName: 'Hopper' });
    });
  });

  // SUPER_ADMIN is the ONLY predefined role. Every other role is created dynamically by SUPER_ADMIN through the
  // application, so a fresh install must never seed one — and the boot-time grant syncs serve SUPER_ADMIN alone.
  describe('seedRoles — SUPER_ADMIN is the only predefined role', () => {
    const lovMap = new Map([
      ['USER_CATEGORY:internal', 1],
      ['USER_CATEGORY:external', 2],
    ]);

    it('a fresh install seeds exactly one role, SUPER_ADMIN — no business role is ever created at startup', async () => {
      const seeded: Map<string, unknown> = await (service as any).seedRoles(manager, lovMap);

      expect([...seeded.keys()]).toEqual(['SUPER_ADMIN']);
      expect(manager.create).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roleName: 'SUPER_ADMIN', userCategoryId: 1 }));
    });

    it('the boot-time grant syncs take no role list and no exclusion list — they serve SUPER_ADMIN alone', async () => {
      usersCount.mockResolvedValue(3);

      await service.onApplicationBootstrap();

      expect(rolePermissionsService.ensureAdminGrants).toHaveBeenCalledWith();
      expect(iamService.ensureAdminPolicyGrants).toHaveBeenCalledWith();
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

  // An initialized installation is never re-seeded: that is what stops a repeated start from creating a second default administrator.
  describe('which database counts as initialized', () => {
    it('every user row counts — soft-deleted accounts included — so an installation that has ever held a user is never treated as fresh', async () => {
      usersCount.mockResolvedValue(1);
      const seed = jest.spyOn(service as any, 'seed').mockResolvedValue(undefined);

      await service.onApplicationBootstrap();

      expect(usersCount).toHaveBeenCalledWith({ withDeleted: true });
      expect(seed).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });
  });

  // The first account of a customer's own installation: a real person's address in production, never the built-in example, and a
  // temporary password that is replaced at the first sign-in.
  describe('the default administrator identity outside a developer machine', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const seedAdmin = () => (service as any).seedSuperAdmin(manager, SUPER_ADMIN_ROLE);

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('production refuses to create the account without an explicit DEFAULT_ADMIN_EMAIL — before anything is written', async () => {
      process.env.NODE_ENV = 'production';

      await expect(seedAdmin()).rejects.toThrow('DEFAULT_ADMIN_EMAIL must be set');

      expect(manager.save).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });

    it('production refuses the built-in example address, however it is cased', async () => {
      process.env.NODE_ENV = 'production';
      for (const demo of ['admin@ccb.local', ' Admin@CCB.local ']) {
        configValues.DEFAULT_ADMIN_EMAIL = demo;

        await expect(seedAdmin()).rejects.toThrow('DEFAULT_ADMIN_EMAIL must be set');
      }

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('production creates the account from an explicit, real address — still forced to change the password at first sign-in', async () => {
      process.env.NODE_ENV = 'production';
      configValues.DEFAULT_ADMIN_EMAIL = 'it.lead@customer.example';

      await seedAdmin();

      const [, userData] = manager.create.mock.calls[0];
      expect(userData).toMatchObject({ email: 'it.lead@customer.example', mustChangePassword: true, active: true });
    });

    it('creates NO account at all when BOOTSTRAP_SEED_ADMIN=false — the role exists, nobody holds it, and no password sits in an env file', async () => {
      process.env.NODE_ENV = 'production';
      configValues.BOOTSTRAP_SEED_ADMIN = 'false';

      await seedAdmin();

      expect(manager.save).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });

    it('a production environment that still carries DEFAULT_ADMIN_PASSWORD after initialization is told to remove it; a developer machine is not nagged', async () => {
      usersCount.mockResolvedValue(3);
      process.env.NODE_ENV = 'production';
      await service.onApplicationBootstrap();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('DEFAULT_ADMIN_PASSWORD is still set'));

      (Logger.prototype.warn as jest.Mock).mockClear();
      process.env.NODE_ENV = 'development';
      await service.onApplicationBootstrap();
      expect(Logger.prototype.warn).not.toHaveBeenCalledWith(expect.stringContaining('DEFAULT_ADMIN_PASSWORD is still set'));
    });
  });

  // The sample Community / Property / Unit data (seed-locations.ts) is ONE estate's master data. A customer's installation must not start life
  // holding it: it is never loaded in production unless BOOTSTRAP_SEED_DEMO_DATA says so, "false" never loads it anywhere, and a developer
  // machine / the test environment keep what they have always got. Nothing else is optional — the catalogue, the lists of values, the
  // attributes, the role and the first administrator are seeded regardless.
  describe('sample (demo) business data', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const setNodeEnv = (value: string | undefined) => {
      if (value === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = value;
    };
    const demoData = (): boolean => (service as any).seedsDemoData();

    afterEach(() => {
      setNodeEnv(originalNodeEnv);
    });

    const CASES: Array<{ nodeEnv: string | undefined; flag: string | undefined; loaded: boolean }> = [
      // production (and anything that is not development / test): off unless explicitly opted in
      { nodeEnv: 'production', flag: undefined, loaded: false },
      { nodeEnv: 'production', flag: '', loaded: false },
      { nodeEnv: 'production', flag: 'false', loaded: false },
      { nodeEnv: 'production', flag: 'true', loaded: true },
      { nodeEnv: 'production', flag: ' TRUE ', loaded: true },
      { nodeEnv: 'production', flag: 'yes', loaded: true },
      { nodeEnv: 'production', flag: 'nonsense', loaded: false },
      { nodeEnv: 'staging', flag: undefined, loaded: false },
      { nodeEnv: undefined, flag: undefined, loaded: false },
      { nodeEnv: undefined, flag: 'true', loaded: true },
      // a developer machine and the test environment: on by default, and "false" turns it off
      { nodeEnv: 'development', flag: undefined, loaded: true },
      { nodeEnv: 'test', flag: undefined, loaded: true },
      { nodeEnv: 'development', flag: 'false', loaded: false },
      { nodeEnv: 'test', flag: 'false', loaded: false },
    ];

    for (const { nodeEnv, flag, loaded } of CASES) {
      it(`NODE_ENV=${nodeEnv ?? '(unset)'} and BOOTSTRAP_SEED_DEMO_DATA=${flag === undefined ? '(unset)' : JSON.stringify(flag)} -> ${loaded ? 'loaded' : 'NOT loaded'}`, () => {
        setNodeEnv(nodeEnv);
        configValues.BOOTSTRAP_SEED_DEMO_DATA = flag;

        expect(demoData()).toBe(loaded);
      });
    }

    describe('what a fresh database receives', () => {
      // Everything seed() calls is replaced by a recording stand-in: the question here is only WHICH steps run.
      const stubSeedSteps = () => {
        for (const step of ['seedPModules', 'seedSubModules', 'seedScreens', 'seedActions']) {
          jest.spyOn(service as any, step).mockResolvedValue(new Map());
        }
        (ensureSteps.lov as any).seedValues = jest.fn().mockResolvedValue(new Map());
        (ensureSteps.attribute as any).seedValues = jest.fn().mockResolvedValue(undefined);
        return {
          seedRoles: jest.spyOn(service as any, 'seedRoles').mockResolvedValue(new Map()),
          seedSuperAdmin: jest.spyOn(service as any, 'seedSuperAdmin').mockResolvedValue(undefined),
          seedLocations: jest.spyOn(service as any, 'seedLocations').mockResolvedValue(undefined),
        };
      };
      const runSeed = () => (service as any).seed(manager) as Promise<void>;

      it('production without the opt-in loads NO sample data — and still seeds the catalogue, the lists, the role and the first administrator', async () => {
        setNodeEnv('production');
        const steps = stubSeedSteps();

        await runSeed();

        expect(steps.seedLocations).not.toHaveBeenCalled();
        expect(steps.seedRoles).toHaveBeenCalledTimes(1);
        expect(steps.seedSuperAdmin).toHaveBeenCalledTimes(1);
        expect((ensureSteps.lov as any).seedValues).toHaveBeenCalledTimes(1);
        expect((ensureSteps.attribute as any).seedValues).toHaveBeenCalledTimes(1);
        expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining('Sample Community / Property / Unit data is not loaded'));
      });

      it('production WITH BOOTSTRAP_SEED_DEMO_DATA=true loads it, once, in the seed transaction\'s own manager', async () => {
        setNodeEnv('production');
        configValues.BOOTSTRAP_SEED_DEMO_DATA = 'true';
        const steps = stubSeedSteps();

        await runSeed();

        expect(steps.seedLocations).toHaveBeenCalledTimes(1);
        expect(steps.seedLocations).toHaveBeenCalledWith(manager);
        expect(Logger.prototype.log).not.toHaveBeenCalledWith(expect.stringContaining('Sample Community / Property / Unit data is not loaded'));
      });

      it('a developer machine keeps loading it by default, and BOOTSTRAP_SEED_DEMO_DATA=false switches it off there too', async () => {
        setNodeEnv('development');
        const steps = stubSeedSteps();

        await runSeed();
        expect(steps.seedLocations).toHaveBeenCalledTimes(1);

        steps.seedLocations.mockClear();
        configValues.BOOTSTRAP_SEED_DEMO_DATA = 'false';
        await runSeed();
        expect(steps.seedLocations).not.toHaveBeenCalled();
      });

      it('the order is fixed: the administrator is seeded BEFORE the sample data (the whole seed is ONE transaction, so a failure in the optional part still rolls everything back and the next start retries)', async () => {
        setNodeEnv('production');
        configValues.BOOTSTRAP_SEED_DEMO_DATA = 'true';
        const steps = stubSeedSteps();

        await runSeed();

        expect(steps.seedSuperAdmin.mock.invocationCallOrder[0]).toBeLessThan(steps.seedLocations.mock.invocationCallOrder[0]);
      });
    });
  });
});

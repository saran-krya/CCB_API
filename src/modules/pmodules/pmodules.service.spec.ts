import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PModulesService } from './pmodules.service';

// PModulesService against stubbed repositories: the admin catalog tree (nesting, filters, totals) and the guard rails that keep the
// platform's core modules available.
describe('PModulesService', () => {
  const module = (overrides: Record<string, unknown>) => ({ type: 'MENU', icon: null, url: null, displayOrder: 0, isActive: true, ...overrides });

  let modules: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock; softRemove: jest.Mock };
  let subModules: { find: jest.Mock };
  let screens: { find: jest.Mock; count: jest.Mock };
  let actionQb: Record<string, jest.Mock>;
  let service: PModulesService;

  const MODULES = [
    module({ id: 1, moduleName: 'Dashboard', code: 'DASHBOARD', displayOrder: 1 }),
    module({ id: 2, moduleName: 'Customer Management', code: 'CUSTOMER_MANAGEMENT', displayOrder: 3 }),
    module({ id: 3, moduleName: 'Legacy Reports', code: 'LEGACY_REPORTS', displayOrder: 9, isActive: false }),
  ];
  const SUB_MODULES = [
    { id: 10, pModuleId: 2, name: 'Customer List', code: 'CUSTOMER_LIST', url: '/customers', displayOrder: 1, isActive: true },
    { id: 11, pModuleId: 2, name: 'Registration Requests', code: 'REGISTRATION_REQUESTS', url: '/customers/registration-requests', displayOrder: 2, isActive: true },
  ];
  const SCREENS = [
    { id: 100, subModuleId: 10, pModuleId: null, name: 'Customer Screen', code: 'CUSTOMER_SCREEN', url: '/customers', displayOrder: 1, isActive: true },
    { id: 101, subModuleId: null, pModuleId: 1, name: 'Overview', code: 'DASH_OVERVIEW', url: '/', displayOrder: 1, isActive: true },
    { id: 102, subModuleId: null, pModuleId: null, name: 'Orphan', code: 'ORPHAN', url: null, displayOrder: 1, isActive: true },
  ];

  beforeEach(() => {
    modules = {
      find: jest.fn().mockResolvedValue(MODULES),
      findOne: jest.fn(),
      save: jest.fn(async (value: unknown) => value),
      softRemove: jest.fn().mockResolvedValue(undefined),
    };
    subModules = { find: jest.fn().mockResolvedValue(SUB_MODULES) };
    screens = { find: jest.fn().mockResolvedValue(SCREENS), count: jest.fn().mockResolvedValue(0) };
    actionQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { screenId: '100', count: '4' },
        { screenId: 101, count: 2 },
      ]),
    };
    const actions = { createQueryBuilder: jest.fn().mockReturnValue(actionQb) };
    service = new PModulesService(modules as never, subModules as never, screens as never, actions as never);
  });

  describe('getCatalog', () => {
    it('nests sub-modules and screens under their module, with each screen\'s active action count', async () => {
      const { modules: tree } = await service.getCatalog();

      expect(tree.map((m) => m.code)).toEqual(['DASHBOARD', 'CUSTOMER_MANAGEMENT', 'LEGACY_REPORTS']);
      const customer = tree[1];
      expect(customer.subModules.map((s) => s.code)).toEqual(['CUSTOMER_LIST', 'REGISTRATION_REQUESTS']);
      expect(customer.subModules[0].screens).toEqual([
        { id: 100, name: 'Customer Screen', code: 'CUSTOMER_SCREEN', url: '/customers', displayOrder: 1, isActive: true, actionCount: 4, isProtected: false },
      ]);
      expect(customer.subModules[1].screens).toEqual([]);
      // A screen directly under a module (no sub-module) appears on the module itself.
      expect(tree[0].screens.map((s) => [s.code, s.actionCount])).toEqual([['DASH_OVERVIEW', 2]]);
    });

    it('counts only ACTIVE actions that belong to a screen', async () => {
      await service.getCatalog();

      expect(actionQb.where).toHaveBeenCalledWith('action.isActive = :active', { active: true });
      expect(actionQb.andWhere).toHaveBeenCalledWith('action.screenId IS NOT NULL');
    });

    it('leaves out a screen that is attached to neither a sub-module nor a module', async () => {
      const { modules: tree } = await service.getCatalog();

      const everyScreenCode = tree.flatMap((m) => [...m.screens, ...m.subModules.flatMap((s) => s.screens)]).map((s) => s.code);
      expect(everyScreenCode).not.toContain('ORPHAN');
    });

    it('reports totals over the WHOLE catalog, whatever the filters keep', async () => {
      const { totals, modules: tree } = await service.getCatalog({ status: 'inactive' });

      expect(tree.map((m) => m.code)).toEqual(['LEGACY_REPORTS']);
      expect(totals).toEqual({ modules: 3, activeModules: 2, subModules: 2, screens: 3, actions: 6 });
    });

    it('marks the platform\'s core modules as protected', async () => {
      const { modules: tree } = await service.getCatalog();

      expect(tree.find((m) => m.code === 'DASHBOARD')?.isProtected).toBe(true);
      expect(tree.find((m) => m.code === 'CUSTOMER_MANAGEMENT')?.isProtected).toBe(false);
    });

    it('marks a sub-module and a screen as protected when their (grand)parent module is protected', async () => {
      const { modules: tree } = await service.getCatalog();

      const dashboard = tree.find((m) => m.code === 'DASHBOARD')!;
      expect(dashboard.screens.find((s) => s.code === 'DASH_OVERVIEW')?.isProtected).toBe(true);
      const customer = tree.find((m) => m.code === 'CUSTOMER_MANAGEMENT')!;
      expect(customer.subModules.find((s) => s.code === 'CUSTOMER_LIST')?.isProtected).toBe(false);
      expect(customer.subModules.find((s) => s.code === 'CUSTOMER_LIST')?.screens.find((s) => s.code === 'CUSTOMER_SCREEN')?.isProtected).toBe(false);
    });

    it('filters on the module\'s own availability', async () => {
      expect((await service.getCatalog({ status: 'active' })).modules.map((m) => m.code)).toEqual(['DASHBOARD', 'CUSTOMER_MANAGEMENT']);
      expect((await service.getCatalog({ status: 'all' })).modules).toHaveLength(3);
    });

    it('search keeps a module when its own name or code matches, case-insensitively', async () => {
      expect((await service.getCatalog({ search: 'legacy' })).modules.map((m) => m.code)).toEqual(['LEGACY_REPORTS']);
      expect((await service.getCatalog({ search: 'CUSTOMER_MANAGEMENT' })).modules.map((m) => m.code)).toEqual(['CUSTOMER_MANAGEMENT']);
    });

    it('search also keeps a module whose sub-module or screen matches', async () => {
      expect((await service.getCatalog({ search: 'registration' })).modules.map((m) => m.code)).toEqual(['CUSTOMER_MANAGEMENT']);
      expect((await service.getCatalog({ search: 'dash_overview' })).modules.map((m) => m.code)).toEqual(['DASHBOARD']);
    });

    it('search and status combine, and a search with no match returns no modules', async () => {
      expect((await service.getCatalog({ search: 'legacy', status: 'active' })).modules).toEqual([]);
      expect((await service.getCatalog({ search: 'zzz' })).modules).toEqual([]);
    });

    it('treats a blank search as no search', async () => {
      expect((await service.getCatalog({ search: '   ' })).modules).toHaveLength(3);
    });
  });

  describe('update', () => {
    const existing = (code: string) => ({ id: 1, moduleName: 'Module', code, isActive: true, subModules: [] });

    it.each(['DASHBOARD', 'SYSTEM_ADMIN', 'PERSONAL_SETTINGS', 'SECURITY_SETTINGS'])('refuses to deactivate the core module %s', async (code) => {
      modules.findOne.mockResolvedValue(existing(code));

      await expect(service.update(1, { isActive: false })).rejects.toThrow(ForbiddenException);
      expect(modules.save).not.toHaveBeenCalled();
    });

    it('refuses to change the code of a core module', async () => {
      modules.findOne.mockResolvedValue(existing('SYSTEM_ADMIN'));

      await expect(service.update(1, { code: 'OTHER' })).rejects.toThrow(/code of a module required/);
    });

    it('still lets a core module be renamed or reordered, and be "activated" (a no-op)', async () => {
      modules.findOne.mockResolvedValue(existing('DASHBOARD'));

      await service.update(1, { displayOrder: 2, isActive: true });

      expect(modules.save).toHaveBeenCalledWith(expect.objectContaining({ code: 'DASHBOARD', displayOrder: 2, isActive: true }));
    });

    it('lets an ordinary module be deactivated', async () => {
      modules.findOne.mockResolvedValue(existing('CUSTOMER_MANAGEMENT'));

      await service.update(1, { isActive: false });

      expect(modules.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });
  });

  describe('remove', () => {
    const existing = (code: string, subModuleCount = 0) => ({ id: 1, code, subModules: Array.from({ length: subModuleCount }, (_, i) => ({ id: i })) });

    it('refuses to delete a core module', async () => {
      modules.findOne.mockResolvedValue(existing('SYSTEM_ADMIN'));

      await expect(service.remove(1)).rejects.toThrow(ForbiddenException);
      expect(modules.softRemove).not.toHaveBeenCalled();
    });

    it('refuses to delete a module that still has sub-modules', async () => {
      modules.findOne.mockResolvedValue(existing('LEGACY_REPORTS', 2));

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      expect(modules.softRemove).not.toHaveBeenCalled();
    });

    it('refuses to delete a module that still has screens directly under it', async () => {
      modules.findOne.mockResolvedValue(existing('LEGACY_REPORTS'));
      screens.count.mockResolvedValue(1);

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      expect(screens.count).toHaveBeenCalledWith({ where: { pModuleId: 1 } });
    });

    it('deletes an empty, ordinary module', async () => {
      modules.findOne.mockResolvedValue(existing('LEGACY_REPORTS'));

      await expect(service.remove(1)).resolves.toEqual({ message: 'Permission module deleted successfully' });
      expect(modules.softRemove).toHaveBeenCalled();
    });
  });
});

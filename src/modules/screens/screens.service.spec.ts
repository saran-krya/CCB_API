import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScreensService } from './screens.service';

// ScreensService against stubbed repositories: ordinary CRUD, plus the guard rails that keep a screen belonging
// (directly, or through its sub-module) to one of the platform's core modules (pmodules.constants.ts,
// PROTECTED_MODULE_CODES) from being deactivated, re-coded, re-parented away or deleted — the same protection
// PModulesService/SubModulesService apply further up the tree (M1).
describe('ScreensService', () => {
  let screens: { findOne: jest.Mock; save: jest.Mock; softRemove: jest.Mock };
  let subModules: { findOne: jest.Mock };
  let pModules: { findOne: jest.Mock };
  let actions: { count: jest.Mock };
  let service: ScreensService;

  const screenDirect = (overrides: Record<string, unknown>) => ({
    id: 1,
    subModuleId: null,
    subModule: null,
    pModuleId: 2,
    pModule: { id: 2, code: 'DASHBOARD' },
    name: 'Overview',
    code: 'DASH_OVERVIEW',
    url: '/',
    displayOrder: 1,
    isActive: true,
    ...overrides,
  });

  const screenViaSubModule = (overrides: Record<string, unknown>) => ({
    id: 1,
    subModuleId: 10,
    subModule: { id: 10, pModuleId: 2, pModule: { id: 2, code: 'SECURITY_SETTINGS' } },
    pModuleId: null,
    pModule: null,
    name: 'Change Password',
    code: 'SETTINGS_PASSWORD',
    url: '/settings/security/password',
    displayOrder: 1,
    isActive: true,
    ...overrides,
  });

  beforeEach(() => {
    screens = {
      findOne: jest.fn(),
      save: jest.fn(async (value: unknown) => value),
      softRemove: jest.fn().mockResolvedValue(undefined),
    };
    subModules = { findOne: jest.fn() };
    pModules = { findOne: jest.fn() };
    actions = { count: jest.fn().mockResolvedValue(0) };
    service = new ScreensService(screens as never, subModules as never, pModules as never, actions as never);
  });

  describe('update', () => {
    it('refuses to deactivate a screen directly under a protected module', async () => {
      screens.findOne.mockResolvedValue(screenDirect({}));

      await expect(service.update(1, { isActive: false })).rejects.toThrow(ForbiddenException);
      expect(screens.save).not.toHaveBeenCalled();
    });

    it('refuses to deactivate a screen whose SUB-MODULE belongs to a protected module', async () => {
      screens.findOne.mockResolvedValue(screenViaSubModule({}));

      await expect(service.update(1, { isActive: false })).rejects.toThrow(ForbiddenException);
    });

    it('refuses to change the code of a protected screen', async () => {
      screens.findOne.mockResolvedValue(screenDirect({}));

      await expect(service.update(1, { code: 'OTHER' })).rejects.toThrow(/code of a screen/);
    });

    it('refuses to move a protected screen to another sub-module', async () => {
      screens.findOne.mockResolvedValue(screenViaSubModule({}));

      await expect(service.update(1, { subModuleId: 99 })).rejects.toThrow(/cannot be moved to another module/);
    });

    it('refuses to move a protected screen to a different module directly', async () => {
      screens.findOne.mockResolvedValue(screenDirect({}));

      await expect(service.update(1, { pModuleId: 99 })).rejects.toThrow(ForbiddenException);
    });

    it('still lets a protected screen be reordered, or "activated" (a no-op)', async () => {
      screens.findOne.mockResolvedValue(screenDirect({}));

      await service.update(1, { displayOrder: 3, isActive: true });

      expect(screens.save).toHaveBeenCalledWith(expect.objectContaining({ displayOrder: 3, isActive: true }));
    });

    it('lets an ordinary screen be deactivated, re-coded, and re-parented', async () => {
      screens.findOne.mockResolvedValue(screenDirect({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));
      subModules.findOne.mockResolvedValue({ id: 10 });

      await service.update(1, { isActive: false, code: 'NEW_CODE', subModuleId: 10, pModuleId: undefined });

      expect(screens.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, code: 'NEW_CODE', subModuleId: 10 }));
    });

    it('still 404s when the target of an ordinary re-parent does not exist', async () => {
      screens.findOne.mockResolvedValue(screenDirect({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));
      subModules.findOne.mockResolvedValue(null);

      await expect(service.update(1, { subModuleId: 999 })).rejects.toThrow(NotFoundException);
    });

    it('still rejects a screen asked to belong to both a sub-module and a module at once', async () => {
      screens.findOne.mockResolvedValue(screenDirect({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));

      await expect(service.update(1, { subModuleId: 10, pModuleId: 2 })).rejects.toThrow(/cannot belong to both/);
    });
  });

  describe('remove', () => {
    it('refuses to delete a screen directly under a protected module', async () => {
      screens.findOne.mockResolvedValue(screenDirect({}));

      await expect(service.remove(1)).rejects.toThrow(ForbiddenException);
      expect(screens.softRemove).not.toHaveBeenCalled();
    });

    it('refuses to delete a screen whose sub-module belongs to a protected module', async () => {
      screens.findOne.mockResolvedValue(screenViaSubModule({}));

      await expect(service.remove(1)).rejects.toThrow(ForbiddenException);
    });

    it('refuses to delete a screen that still defines actions', async () => {
      screens.findOne.mockResolvedValue(screenDirect({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));
      actions.count.mockResolvedValue(2);

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      expect(screens.softRemove).not.toHaveBeenCalled();
    });

    it('deletes an empty, ordinary screen', async () => {
      screens.findOne.mockResolvedValue(screenDirect({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));

      await expect(service.remove(1)).resolves.toEqual({ message: 'Screen deleted successfully' });
      expect(screens.softRemove).toHaveBeenCalled();
    });
  });
});

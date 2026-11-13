import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubModulesService } from './sub-modules.service';

// SubModulesService against stubbed repositories: ordinary CRUD, plus the guard rails that keep a sub-module
// belonging to one of the platform's core modules (pmodules.constants.ts, PROTECTED_MODULE_CODES) from being
// deactivated, re-coded, re-parented away or deleted — the same protection PModulesService applies to the module
// row itself, one level further down the tree (M1).
describe('SubModulesService', () => {
  let subModules: { findOne: jest.Mock; save: jest.Mock; softRemove: jest.Mock };
  let pModules: { findOne: jest.Mock };
  let service: SubModulesService;

  const subModule = (overrides: Record<string, unknown>) => ({
    id: 1,
    pModuleId: 2,
    name: 'Change Password',
    code: 'SETTINGS_PASSWORD',
    displayOrder: 1,
    isActive: true,
    screens: [],
    pModule: { id: 2, code: 'SECURITY_SETTINGS' },
    ...overrides,
  });

  beforeEach(() => {
    subModules = {
      findOne: jest.fn(),
      save: jest.fn(async (value: unknown) => value),
      softRemove: jest.fn().mockResolvedValue(undefined),
    };
    pModules = { findOne: jest.fn() };
    service = new SubModulesService(subModules as never, pModules as never);
  });

  describe('update', () => {
    it('refuses to deactivate a sub-module that belongs to a protected module', async () => {
      subModules.findOne.mockResolvedValue(subModule({}));

      await expect(service.update(1, { isActive: false })).rejects.toThrow(ForbiddenException);
      expect(subModules.save).not.toHaveBeenCalled();
    });

    it('refuses to change the code of a sub-module that belongs to a protected module', async () => {
      subModules.findOne.mockResolvedValue(subModule({}));

      await expect(service.update(1, { code: 'OTHER' })).rejects.toThrow(/code of a sub-module/);
    });

    it('refuses to move a sub-module out of its protected module', async () => {
      subModules.findOne.mockResolvedValue(subModule({}));

      await expect(service.update(1, { pModuleId: 9 })).rejects.toThrow(/cannot be moved to another module/);
      expect(pModules.findOne).not.toHaveBeenCalled();
    });

    it('still lets a protected sub-module be reordered, or "activated" (a no-op)', async () => {
      subModules.findOne.mockResolvedValue(subModule({}));

      await service.update(1, { displayOrder: 5, isActive: true });

      expect(subModules.save).toHaveBeenCalledWith(expect.objectContaining({ displayOrder: 5, isActive: true }));
    });

    it('lets an ordinary sub-module be deactivated, re-coded and re-parented', async () => {
      subModules.findOne.mockResolvedValue(subModule({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));
      pModules.findOne.mockResolvedValue({ id: 9 });

      await service.update(1, { isActive: false, pModuleId: 9 });

      expect(subModules.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, pModuleId: 9 }));
    });

    it('still 404s when the target module of an ordinary re-parent does not exist', async () => {
      subModules.findOne.mockResolvedValue(subModule({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));
      pModules.findOne.mockResolvedValue(null);

      await expect(service.update(1, { pModuleId: 999 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('refuses to delete a sub-module that belongs to a protected module', async () => {
      subModules.findOne.mockResolvedValue(subModule({}));

      await expect(service.remove(1)).rejects.toThrow(ForbiddenException);
      expect(subModules.softRemove).not.toHaveBeenCalled();
    });

    it('refuses to delete a sub-module that still has screens', async () => {
      subModules.findOne.mockResolvedValue(
        subModule({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' }, screens: [{ id: 1 }] }),
      );

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      expect(subModules.softRemove).not.toHaveBeenCalled();
    });

    it('deletes an empty, ordinary sub-module', async () => {
      subModules.findOne.mockResolvedValue(subModule({ pModule: { id: 2, code: 'CUSTOMER_MANAGEMENT' } }));

      await expect(service.remove(1)).resolves.toEqual({ message: 'Sub module deleted successfully' });
      expect(subModules.softRemove).toHaveBeenCalled();
    });
  });
});

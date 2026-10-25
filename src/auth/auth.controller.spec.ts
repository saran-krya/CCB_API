import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AttributeService } from '../modules/attribute/attribute.service';
import { RolePermissionsService } from '../modules/role-permissions/role-permissions.service';
import { AuthenticatedUser, AuthenticatedCustomer } from './interfaces/authenticated-user.interface';

// Isolated test for GET /auth/me/actions — the route the frontend's Policy-based sidebar-visibility
// feature calls to learn the current session's own granted Action codes. Confirms it delegates to
// RolePermissionsService.getMyActionCodes (the same resolution path PermissionGuard itself uses,
// never the legacy permission tree) for a staff principal, and never attempts to read a roleId off a
// customer principal (which has none) — a customer session always gets an empty array.
describe('AuthController.getMyActionCodes', () => {
  let controller: AuthController;
  let getMyActionCodes: jest.Mock;
  let getAllMenus: jest.Mock;

  beforeEach(async () => {
    getMyActionCodes = jest.fn();
    getAllMenus = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: AttributeService, useValue: {} },
        { provide: RolePermissionsService, useValue: { getMyActionCodes, getAllMenus } },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  it("returns the staff principal's own granted action codes, resolved by their roleId", async () => {
    getMyActionCodes.mockResolvedValue(['VIEW_USER', 'CREATE_USER']);
    const staff: AuthenticatedUser = { sub: 1, email: 'admin@ccb.local', roleId: 2, roleName: 'SUPER_ADMIN', type: 'staff' };

    const result = await controller.getMyActionCodes(staff);

    expect(getMyActionCodes).toHaveBeenCalledWith(2);
    expect(result).toEqual({ actionCodes: ['VIEW_USER', 'CREATE_USER'] });
  });

  it('a customer principal always gets an empty array, never a roleId lookup (a Customer has no Role)', async () => {
    const customer: AuthenticatedCustomer = { sub: 1, email: 'resident@example.com', type: 'customer' };

    const result = await controller.getMyActionCodes(customer);

    expect(result).toEqual({ actionCodes: [] });
    expect(getMyActionCodes).not.toHaveBeenCalled();
  });

  // Backs GET /auth/me/nav-catalog — the sidebar's structural data source for a role configured
  // purely through Policies, which the legacy role_permissions tree (profile.permissions) can't
  // supply since it only lists a module/submodule a role already has a legacy grant row for.
  describe('getMyNavCatalog', () => {
    it("delegates to RolePermissionsService.getAllMenus() for a staff principal, regardless of that principal's own role", async () => {
      const catalog = [{ moduleId: 1, code: 'DASHBOARD', hasAccess: true, subModule: [] }];
      getAllMenus.mockResolvedValue(catalog);
      const staff: AuthenticatedUser = { sub: 1, email: 'finance@ccb.local', roleId: 13, roleName: 'FINANCE', type: 'staff' };

      const result = await controller.getMyNavCatalog(staff);

      expect(getAllMenus).toHaveBeenCalledWith();
      expect(result).toBe(catalog);
    });

    it('a customer principal always gets an empty array, never calls getAllMenus', async () => {
      const customer: AuthenticatedCustomer = { sub: 1, email: 'resident@example.com', type: 'customer' };

      const result = await controller.getMyNavCatalog(customer);

      expect(result).toEqual([]);
      expect(getAllMenus).not.toHaveBeenCalled();
    });
  });
});

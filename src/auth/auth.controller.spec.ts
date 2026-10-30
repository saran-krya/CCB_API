import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AttributeService } from '../modules/attribute/attribute.service';
import { RolePermissionsService } from '../modules/role-permissions/role-permissions.service';
import { AuthenticatedUser, AuthenticatedCustomer } from './interfaces/authenticated-user.interface';

// Isolated test for GET /auth/me/actions — the route the frontend's Policy-based sidebar-visibility
// feature calls to learn the current session's own granted Action codes. Confirms it returns the
// UNION across ALL of the principal's live roleIds via RolePermissionsService.getMyActionCodesForRoles
// (the same resolution path PermissionGuard itself uses, never the legacy permission tree) for a
// staff principal, and never attempts to read a roleId off a customer principal (which has none) — a
// customer session always gets an empty array.
describe('AuthController.getMyActionCodes', () => {
  let controller: AuthController;
  let getMyActionCodes: jest.Mock;
  let getMyActionCodesForRoles: jest.Mock;
  let getAllMenus: jest.Mock;

  beforeEach(async () => {
    getMyActionCodes = jest.fn();
    getMyActionCodesForRoles = jest.fn();
    getAllMenus = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: AttributeService, useValue: {} },
        { provide: RolePermissionsService, useValue: { getMyActionCodes, getMyActionCodesForRoles, getAllMenus } },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  it("returns the UNION of granted action codes across ALL of the staff principal's live roleIds, resolved in one lookup", async () => {
    getMyActionCodesForRoles.mockResolvedValue(['VIEW_USER', 'CREATE_USER', 'APPROVE_TARIFF']);
    const staff: AuthenticatedUser = {
      sub: 1, email: 'admin@ccb.local', roleId: 2, roleName: 'ADMIN', roleIds: [2, 7], roleNames: ['ADMIN', 'FINANCE'], type: 'staff',
    };

    const result = await controller.getMyActionCodes(staff);

    expect(getMyActionCodesForRoles).toHaveBeenCalledTimes(1);
    expect(getMyActionCodesForRoles).toHaveBeenCalledWith([2, 7], 1);
    expect(result).toEqual({ actionCodes: ['VIEW_USER', 'CREATE_USER', 'APPROVE_TARIFF'] });
  });

  it('never uses the single-role lookup, even for a principal holding just one role', async () => {
    getMyActionCodesForRoles.mockResolvedValue(['VIEW_USER']);
    const staff: AuthenticatedUser = { sub: 1, email: 'admin@ccb.local', roleId: 2, roleName: 'ADMIN', roleIds: [2], roleNames: ['ADMIN'], type: 'staff' };

    await controller.getMyActionCodes(staff);

    expect(getMyActionCodesForRoles).toHaveBeenCalledWith([2], 1);
    expect(getMyActionCodes).not.toHaveBeenCalled();
  });

  it('follows the LIVE roleIds, not the singular roleId — a stale primary-role claim never decides what the principal is shown', async () => {
    getMyActionCodesForRoles.mockResolvedValue(['VIEW_METER']);
    // roleId 2 is a leftover claim; the role set the user actually holds right now is [9].
    const staff: AuthenticatedUser = { sub: 1, email: 'ops@ccb.local', roleId: 2, roleName: 'SUPER_ADMIN', roleIds: [9], roleNames: ['OPERATIONS'], type: 'staff' };

    await controller.getMyActionCodes(staff);

    expect(getMyActionCodesForRoles).toHaveBeenCalledWith([9], 1);
    expect(getMyActionCodesForRoles).not.toHaveBeenCalledWith(expect.arrayContaining([2]));
  });

  it('falls back to [roleId] only for a principal built without roleIds (the live primary)', async () => {
    getMyActionCodesForRoles.mockResolvedValue(['VIEW_USER', 'CREATE_USER']);
    const staff: AuthenticatedUser = { sub: 1, email: 'admin@ccb.local', roleId: 2, roleName: 'SUPER_ADMIN', type: 'staff' };

    const result = await controller.getMyActionCodes(staff);

    expect(getMyActionCodesForRoles).toHaveBeenCalledWith([2], 1);
    expect(result).toEqual({ actionCodes: ['VIEW_USER', 'CREATE_USER'] });
  });

  it('an EMPTY live role set is passed through as empty, never replaced by the singular roleId', async () => {
    getMyActionCodesForRoles.mockResolvedValue([]);
    const staff: AuthenticatedUser = { sub: 1, email: 'x@ccb.local', roleId: 2, roleName: 'ADMIN', roleIds: [], roleNames: [], type: 'staff' };

    const result = await controller.getMyActionCodes(staff);

    expect(getMyActionCodesForRoles).toHaveBeenCalledWith([], 1);
    expect(result).toEqual({ actionCodes: [] });
  });

  it("passes the authenticated user's id with the role set, so the user's OWN inline policies are part of the union", async () => {
    getMyActionCodesForRoles.mockResolvedValue(['VIEW_USER', 'TARIFF_VIEW']);
    const staff: AuthenticatedUser = { sub: 42, email: 'u@ccb.local', roleId: 2, roleName: 'ADMIN', roleIds: [2], roleNames: ['ADMIN'], type: 'staff' };

    const result = await controller.getMyActionCodes(staff);

    expect(getMyActionCodesForRoles).toHaveBeenCalledWith([2], 42);
    expect(result).toEqual({ actionCodes: ['VIEW_USER', 'TARIFF_VIEW'] });
  });

  it('a customer principal always gets an empty array, never a roleId lookup (a Customer has no Role)', async () => {
    const customer: AuthenticatedCustomer = { sub: 1, email: 'resident@example.com', type: 'customer' };

    const result = await controller.getMyActionCodes(customer);

    expect(result).toEqual({ actionCodes: [] });
    expect(getMyActionCodes).not.toHaveBeenCalled();
    expect(getMyActionCodesForRoles).not.toHaveBeenCalled();
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

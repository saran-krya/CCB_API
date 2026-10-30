import { NotFoundException } from '@nestjs/common';
import { ROLES } from '@app/common/constants/global';
import { UserPermissionsService } from './user-permissions.service';

// The User Details > Permissions table is searched, type-filtered, sorted and paged HERE, not in the browser.
// Inline policies keep the SUPER_ADMIN-only boundary they have everywhere else: for any other viewer they are
// neither returned nor offered as a type option.
describe('UserPermissionsService.list', () => {
  const role = (id: number, roleName: string, label: string | null) => ({ role: { id, roleName, userCategory: label ? { label } : null } });

  let service: UserPermissionsService;
  let usersRepo: { exist: jest.Mock };
  let userRolesRepo: { find: jest.Mock };
  let inlineRepo: { find: jest.Mock };

  const superAdmin = { sub: 1, email: 'a@x', roleId: 1, roleName: ROLES.SUPER_ADMIN, roleNames: [ROLES.SUPER_ADMIN] } as any;
  const staff = { sub: 2, email: 'b@x', roleId: 2, roleName: 'FINANCE', roleNames: ['FINANCE'] } as any;
  const q = (over: Record<string, unknown> = {}) =>
    ({ page: 1, limit: 10, sortBy: 'name', sortOrder: 'ASC', ...over }) as any;

  beforeEach(() => {
    usersRepo = { exist: jest.fn().mockResolvedValue(true) };
    userRolesRepo = {
      find: jest.fn().mockResolvedValue([role(4, 'FINANCE', 'Internal'), role(3, 'OPERATIONS', 'Field'), role(9, 'BILLING', null)]),
    };
    inlineRepo = { find: jest.fn().mockResolvedValue([{ id: 5, name: 'Temp audit access' }]) };
    service = new UserPermissionsService(usersRepo as any, userRolesRepo as any, inlineRepo as any);
  });

  it('404s for a user that does not exist', async () => {
    usersRepo.exist.mockResolvedValue(false);
    await expect(service.list(99, q(), superAdmin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns roles and inline policies to a SUPER_ADMIN, with both type options', async () => {
    const result = await service.list(7, q(), superAdmin);
    expect(result.items.map((r) => r.key)).toEqual(['role:9', 'role:4', 'role:3', 'inline:5']);
    expect(result.meta.typeOptions).toEqual([
      { value: 'role', label: 'Role' },
      { value: 'inline', label: 'Inline policy' },
    ]);
  });

  it('never loads or returns inline policies for anyone else, and does not offer the type', async () => {
    const result = await service.list(7, q(), staff);
    expect(inlineRepo.find).not.toHaveBeenCalled();
    expect(result.items.every((r) => r.kind === 'role')).toBe(true);
    expect(result.meta.typeOptions).toEqual([{ value: 'role', label: 'Role' }]);
  });

  it('asking a non-SUPER_ADMIN for the inline type is an empty list, not an error', async () => {
    const result = await service.list(7, q({ type: 'inline' }), staff);
    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('filters by type', async () => {
    const result = await service.list(7, q({ type: 'inline' }), superAdmin);
    expect(result.items.map((r) => r.key)).toEqual(['inline:5']);
  });

  it('searches the name, type, attached-via and user category (case-insensitive)', async () => {
    expect((await service.list(7, q({ 'search.query': 'finan' }), superAdmin)).items.map((r) => r.key)).toEqual(['role:4']);
    expect((await service.list(7, q({ 'search.query': 'FIELD' }), superAdmin)).items.map((r) => r.key)).toEqual(['role:3']);
    expect((await service.list(7, q({ 'search.query': 'inline' }), superAdmin)).items.map((r) => r.key)).toEqual(['inline:5']);
  });

  it('sorts by the requested column and direction', async () => {
    const desc = await service.list(7, q({ sortOrder: 'DESC' }), superAdmin);
    expect(desc.items.map((r) => r.name)).toEqual(['Temp audit access', 'OPERATIONS', 'FINANCE', 'BILLING']);
    const byType = await service.list(7, q({ sortBy: 'type' }), superAdmin);
    // "Inline policy" < "Role" alphabetically, so ascending puts the inline policy first.
    expect(byType.items.map((r) => r.kind)).toEqual(['inline', 'role', 'role', 'role']);
  });

  it('pages the result and reports the total, clamping a page past the end to the last one', async () => {
    const first = await service.list(7, q({ limit: 3 }), superAdmin);
    expect(first.items).toHaveLength(3);
    expect(first.pagination).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    const beyond = await service.list(7, q({ limit: 3, page: 9 }), superAdmin);
    expect(beyond.pagination.page).toBe(2);
    expect(beyond.items.map((r) => r.key)).toEqual(['inline:5']);
  });

  it('skips a role that was soft-deleted after it was assigned', async () => {
    userRolesRepo.find.mockResolvedValue([{ role: null }, role(4, 'FINANCE', 'Internal')]);
    const result = await service.list(7, q({ type: 'role' }), superAdmin);
    expect(result.items.map((r) => r.key)).toEqual(['role:4']);
  });
});

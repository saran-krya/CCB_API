/**
 * Test helper (kept under test/, which the production build excludes). PermissionGuard resolves a route's
 * required codes with ONE call, RolePermissionsService.rolesHaveAnyAction(roleIds, codes, userId). Many specs
 * drive the real guard with a mock whose behaviour is defined per test through a single `rolesHaveAction`
 * jest.fn (roleIds, code, userId) -> boolean; this wraps that mock so `rolesHaveAnyAction` is derived from it
 * with the exact same meaning (true iff ANY listed code is granted), and the spec's existing per-code
 * implementations keep working unchanged.
 */
export function rolePermissionsMock(rolesHaveAction: jest.Mock) {
  return {
    rolesHaveAction,
    rolesHaveAnyAction: async (roleIds: number[], codes: string[], userId?: number): Promise<boolean> => {
      for (const code of codes) {
        if (await rolesHaveAction(roleIds, code, userId)) return true;
      }
      return false;
    },
  };
}

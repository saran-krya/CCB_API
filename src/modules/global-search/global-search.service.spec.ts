import { GlobalSearchService } from './global-search.service';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from './interfaces/search-provider.interface';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';

// Isolated unit tests for GlobalSearchService's registry/fan-out/grouping logic — every dependency
// (providers, RolePermissionsService) is a hand-written fake, no real database or HTTP involved. This
// is what actually proves the "typing 'roles' finds nothing because no Role record contains that text,
// not because the service is broken" diagnosis: a fake provider standing in for a real one behaves
// identically from the service's point of view, so these tests pin the exact contract the diagnosis
// depends on (isEnabledFor gates a provider out entirely; a provider that finds nothing is normal, not
// an error; one module's data never shows up under another's heading).
function fakeProvider(overrides: Partial<GlobalSearchProvider> & { providerName: string }): GlobalSearchProvider {
  return {
    isEnabledFor: () => true,
    search: async () => [],
    ...overrides,
  };
}

function resultItem(overrides: Partial<GlobalSearchResultItem> = {}): GlobalSearchResultItem {
  return {
    entityType: 'TEST',
    id: '1',
    module: 'Test Module',
    title: 'Test Item',
    url: '/test/1',
    ...overrides,
  };
}

describe('GlobalSearchService', () => {
  let rolePermissions: { getMyActionCodesForRoles: jest.Mock; anyRoleIsSuperAdmin: jest.Mock };

  beforeEach(() => {
    rolePermissions = {
      getMyActionCodesForRoles: jest.fn().mockResolvedValue(['VIEW_USER', 'VIEW_ROLE']),
      anyRoleIsSuperAdmin: jest.fn().mockResolvedValue(false),
    };
  });

  const makeService = (providers: GlobalSearchProvider[]) =>
    new GlobalSearchService(providers, rolePermissions as unknown as RolePermissionsService);

  it('returns an empty result, never an error, for a blank term — without calling any provider', async () => {
    const provider = fakeProvider({ providerName: 'A', search: jest.fn() });
    const service = makeService([provider]);

    const result = await service.search('   ', 10, [1]);

    expect(result).toEqual({ query: '   ', groups: [], totalCount: 0 });
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('skips a provider whose isEnabledFor returns false, and never calls its search', async () => {
    const disabled = fakeProvider({ providerName: 'Disabled', isEnabledFor: () => false, search: jest.fn() });
    const enabled = fakeProvider({ providerName: 'Enabled', search: async () => [resultItem()] });
    const service = makeService([disabled, enabled]);

    const result = await service.search('roles', 10, [1]);

    expect(disabled.search).not.toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
  });

  it('a provider finding zero matches is normal — the overall search still succeeds with other providers’ results', async () => {
    const empty = fakeProvider({ providerName: 'Empty', search: async () => [] });
    const withResults = fakeProvider({ providerName: 'WithResults', search: async () => [resultItem({ module: 'Other Module' })] });
    const service = makeService([empty, withResults]);

    const result = await service.search('roles', 10, [1]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].module).toBe('Other Module');
  });

  it('a provider that throws is excluded from the result, not surfaced as a 500 for the whole search', async () => {
    const broken = fakeProvider({ providerName: 'Broken', search: async () => { throw new Error('boom'); } });
    const healthy = fakeProvider({ providerName: 'Healthy', search: async () => [resultItem()] });
    const service = makeService([broken, healthy]);

    const result = await service.search('term', 10, [1]);

    expect(result.totalCount).toBe(1);
  });

  it('groups same-module results from two different providers into one group, not two', async () => {
    const providerA = fakeProvider({ providerName: 'A', search: async () => [resultItem({ id: '1', module: 'Meter Management', entityType: 'MASTER_METER' })] });
    const providerB = fakeProvider({ providerName: 'B', search: async () => [resultItem({ id: '2', module: 'Meter Management', entityType: 'SUB_METER' })] });
    const service = makeService([providerA, providerB]);

    const result = await service.search('term', 10, [1]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items).toHaveLength(2);
  });

  it('passes the per-module limit through to each provider unchanged', async () => {
    const provider = fakeProvider({ providerName: 'A', search: jest.fn().mockResolvedValue([]) });
    const service = makeService([provider]);

    await service.search('term', 7, [1]);

    expect(provider.search).toHaveBeenCalledWith('term', 7);
  });

  it('resolves granted action codes and SUPER_ADMIN status from the live roleIds exactly once, and hands both to every provider’s isEnabledFor', async () => {
    rolePermissions.getMyActionCodesForRoles.mockResolvedValue(['VIEW_UNIT']);
    rolePermissions.anyRoleIsSuperAdmin.mockResolvedValue(true);
    let seenContext: SearchAuthContext | undefined;
    const provider = fakeProvider({
      providerName: 'A',
      isEnabledFor: (context) => {
        seenContext = context;
        return true;
      },
    });
    const service = makeService([provider]);

    await service.search('term', 10, [5, 6], 99);

    expect(rolePermissions.getMyActionCodesForRoles).toHaveBeenCalledWith([5, 6], 99);
    expect(rolePermissions.anyRoleIsSuperAdmin).toHaveBeenCalledWith([5, 6]);
    expect(seenContext?.isSuperAdmin).toBe(true);
    expect(seenContext?.grantedActionCodes.has('VIEW_UNIT')).toBe(true);
  });
});

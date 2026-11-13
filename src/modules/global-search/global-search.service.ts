import { Inject, Injectable, Logger } from '@nestjs/common';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { GLOBAL_SEARCH_PROVIDERS } from './global-search.constants';
import { GlobalSearchProvider, SearchAuthContext } from './interfaces/search-provider.interface';
import { GlobalSearchResponseDataDto } from './dto/global-search-response.dto';
import { normalizeSearchTerm } from '../../common/utils/search-text.util';

@Injectable()
export class GlobalSearchService {
  private readonly logger = new Logger(GlobalSearchService.name);

  constructor(
    @Inject(GLOBAL_SEARCH_PROVIDERS) private readonly providers: GlobalSearchProvider[],
    private readonly rolePermissions: RolePermissionsService,
  ) {}

  /**
   * Fans out to every registered provider the caller is authorized for, in parallel, and groups what
   * comes back by module. `roleIds`/`userId` are the live, request-resolved values off the JWT
   * principal (never the signed, possibly-stale `roleId`/`roleName` singular claims) — the same values
   * every other authorization check in this app already uses (see AuthenticatedUser's own doc comment).
   *
   * Returns an empty result (not an error) for a blank/over-length term — GlobalSearchController's DTO
   * validation already rejects an empty `q` before this is ever called, so that path only matters if
   * this service is ever called some other way later.
   */
  async search(rawTerm: string, limitPerModule: number, roleIds: number[], userId?: number): Promise<GlobalSearchResponseDataDto> {
    const term = normalizeSearchTerm(rawTerm);
    if (!term) {
      return { query: rawTerm ?? '', groups: [], totalCount: 0 };
    }

    const context = await this.buildAuthContext(roleIds, userId);
    const enabledProviders = this.providers.filter((provider) => this.isEnabledSafely(provider, context));

    const resultsByProvider = await Promise.all(
      enabledProviders.map((provider) => this.searchSafely(provider, term, limitPerModule)),
    );

    // Same-module results from more than one provider (e.g. Master Meters + Sub Meters both labelled
    // "Meter Management") land in one group, in registration order — never a second group with the
    // same heading.
    const groupsByModule = new Map<string, GlobalSearchResponseDataDto['groups'][number]>();
    for (const items of resultsByProvider) {
      for (const item of items) {
        let group = groupsByModule.get(item.module);
        if (!group) {
          group = { module: item.module, items: [] };
          groupsByModule.set(item.module, group);
        }
        group.items.push(item);
      }
    }

    const groups = [...groupsByModule.values()];
    const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
    return { query: term, groups, totalCount };
  }

  private async buildAuthContext(roleIds: number[], userId?: number): Promise<SearchAuthContext> {
    const [grantedActionCodes, isSuperAdmin] = await Promise.all([
      this.rolePermissions.getMyActionCodesForRoles(roleIds, userId),
      this.rolePermissions.anyRoleIsAdministrator(roleIds),
    ]);
    return { grantedActionCodes: new Set(grantedActionCodes), isSuperAdmin };
  }

  // A provider's own isEnabledFor/search must never be allowed to take the whole endpoint down —
  // one module's bug (or a transient DB issue scoped to just that table) should degrade to "that
  // module's results are missing this time", not a 500 for every other module's results too.
  private isEnabledSafely(provider: GlobalSearchProvider, context: SearchAuthContext): boolean {
    try {
      return provider.isEnabledFor(context);
    } catch (error) {
      this.logger.warn(`${provider.providerName}.isEnabledFor threw — excluding it from this search: ${(error as Error).message}`);
      return false;
    }
  }

  private async searchSafely(provider: GlobalSearchProvider, term: string, limit: number) {
    try {
      return await provider.search(term, limit);
    } catch (error) {
      this.logger.warn(`${provider.providerName}.search threw — returning no results for it: ${(error as Error).message}`);
      return [];
    }
  }
}

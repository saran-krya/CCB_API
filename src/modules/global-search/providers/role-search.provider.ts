import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../role/entities/role.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class RoleSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'RoleSearchProvider';
  private static readonly MODULE_LABEL = 'Role Management';

  constructor(@InjectRepository(Role) private readonly roles: Repository<Role>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_ROLE);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // userCategoryId is nullable (legacy roles may carry none), so this is a leftJoin, never an
    // innerJoin — mirroring how role.service.ts's own list/search queries join the same relation.
    const rows = await applyMultiWordSearch(
      this.roles
        .createQueryBuilder('role')
        .leftJoin('role.userCategory', 'userCategory')
        .select(['role.id', 'role.roleName', 'role.roleDescription', 'userCategory.id', 'userCategory.label']),
      ['role.roleName', 'role.roleDescription'],
      term,
    )
      .orderBy('role.roleName', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((role) => ({
      entityType: 'ROLE',
      id: String(role.id),
      module: RoleSearchProvider.MODULE_LABEL,
      title: role.roleName,
      description: role.userCategory?.label,
      url: `/system-admin/roles/view/${role.id}`,
    }));
  }
}

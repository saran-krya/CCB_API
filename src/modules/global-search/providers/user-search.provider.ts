import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class UserSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'UserSearchProvider';
  private static readonly MODULE_LABEL = 'User Management';

  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_USER);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // Each word of `term` must appear somewhere across these columns, independently — "Saran Kumar"
    // matches a user named "Kumar, Saran" or with "Saran" as first name and "Kumar" only in the email,
    // not just one literally containing that exact two-word phrase.
    const rows = await applyMultiWordSearch(
      this.users
        .createQueryBuilder('u')
        .select(['u.id', 'u.firstName', 'u.middleName', 'u.lastName', 'u.email', 'u.employeeCode', 'u.active']),
      ['u.firstName', 'u.middleName', 'u.lastName', 'u.email', 'u.employeeCode'],
      term,
    )
      .orderBy('u.firstName', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((user) => ({
      entityType: 'USER',
      id: String(user.id),
      module: UserSearchProvider.MODULE_LABEL,
      title: [user.firstName, user.middleName, user.lastName].filter(Boolean).join(' '),
      description: user.email,
      status: user.active ? 'Active' : 'Inactive',
      url: `/system-admin/users/view/${user.id}`,
    }));
  }
}

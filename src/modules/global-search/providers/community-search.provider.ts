import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Community } from '../../community/entities/community.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class CommunitySearchProvider implements GlobalSearchProvider {
  readonly providerName = 'CommunitySearchProvider';
  private static readonly MODULE_LABEL = 'Community Management';

  constructor(@InjectRepository(Community) private readonly communities: Repository<Community>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_COMMUNITY);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // Each word of `term` independently — "Azizi Pearl" matches "The Pearl by Azizi" just as well as a
    // community literally named that exact two-word phrase.
    const rows = await applyMultiWordSearch(
      this.communities.createQueryBuilder('c').select(['c.id', 'c.name', 'c.code', 'c.businessCode', 'c.status']),
      ['c.name', 'c.code', 'c.businessCode'],
      term,
    )
      .orderBy('c.name', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((community) => ({
      entityType: 'COMMUNITY',
      id: String(community.id),
      module: CommunitySearchProvider.MODULE_LABEL,
      title: community.name,
      description: community.businessCode ?? community.code,
      status: humanizeEnumValue(community.status),
      url: `/communities/${community.id}`,
    }));
  }
}

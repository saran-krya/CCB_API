import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Property } from '../../property/entities/property.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class PropertySearchProvider implements GlobalSearchProvider {
  readonly providerName = 'PropertySearchProvider';
  private static readonly MODULE_LABEL = 'Community Management';

  constructor(@InjectRepository(Property) private readonly properties: Repository<Property>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_PROPERTY);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // /communities/[communityId]/properties/[propertyId] needs the parent community id, so the
    // community relation is joined (never a second query per row) purely to read its id/name for the
    // URL and description — but also included as a searchable column: "Azizi Pearl" should match a
    // property named "Pearl Tower" under a community named "Azizi", not only a property whose OWN name
    // contains both words.
    const rows = await applyMultiWordSearch(
      this.properties
        .createQueryBuilder('property')
        .innerJoin('property.community', 'community')
        .select(['property.id', 'property.name', 'property.code', 'property.businessCode', 'property.status', 'community.id', 'community.name']),
      ['property.name', 'property.code', 'property.businessCode', 'community.name'],
      term,
    )
      .orderBy('property.name', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((property) => ({
      entityType: 'PROPERTY',
      id: String(property.id),
      module: PropertySearchProvider.MODULE_LABEL,
      title: property.name,
      description: property.community.name,
      status: humanizeEnumValue(property.status),
      url: `/communities/${property.community.id}/properties/${property.id}`,
    }));
  }
}

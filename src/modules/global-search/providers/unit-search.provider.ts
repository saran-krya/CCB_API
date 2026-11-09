import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Unit } from '../../unit/entities/unit.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class UnitSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'UnitSearchProvider';
  private static readonly MODULE_LABEL = 'Community Management';

  constructor(@InjectRepository(Unit) private readonly units: Repository<Unit>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_UNIT);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // /communities/[communityId]/properties/[propertyId]/units/[unitId] needs both parent ids, so the
    // property and community relations are joined (never a second query per row) purely to read their
    // ids/names for the URL and description — and also searched: "Azizi T01" should match a unit coded
    // T01 inside a property under a community named Azizi, not only a unit whose own number/code
    // contains both words.
    const rows = await applyMultiWordSearch(
      this.units
        .createQueryBuilder('unit')
        .innerJoin('unit.property', 'property')
        .innerJoin('property.community', 'community')
        .select(['unit.id', 'unit.unitNumber', 'unit.businessCode', 'unit.status', 'property.id', 'property.name', 'community.id', 'community.name']),
      ['unit.unitNumber', 'unit.businessCode', 'property.name', 'community.name'],
      term,
    )
      .orderBy('unit.unitNumber', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((unit) => ({
      entityType: 'UNIT',
      id: String(unit.id),
      module: UnitSearchProvider.MODULE_LABEL,
      title: unit.businessCode ?? unit.unitNumber,
      description: `${unit.property.name} · ${unit.property.community.name}`,
      status: humanizeEnumValue(unit.status),
      url: `/communities/${unit.property.community.id}/properties/${unit.property.id}/units/${unit.id}`,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TariffVersion } from '../../tariff/entities/tariff-version.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class TariffSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'TariffSearchProvider';
  private static readonly MODULE_LABEL = 'Business Admin';

  constructor(@InjectRepository(TariffVersion) private readonly versions: Repository<TariffVersion>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.TARIFF_VIEW);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    const rows = await applyMultiWordSearch(
      this.versions.createQueryBuilder('version').select(['version.id', 'version.name', 'version.status', 'version.propertyType', 'version.version']),
      ['version.name'],
      term,
    )
      .orderBy('version.name', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((version) => ({
      entityType: 'TARIFF',
      id: String(version.id),
      module: TariffSearchProvider.MODULE_LABEL,
      title: version.name,
      description: `${version.propertyType} · v${version.version}`,
      status: humanizeEnumValue(version.status),
      // GET /tariffs/:id resolves :id against TariffVersion's own id (confirmed in
      // TariffService.findOne), not TariffMaster's — this matches the real detail endpoint exactly.
      url: `/admin/business/tariff-config/view/${version.id}`,
    }));
  }
}

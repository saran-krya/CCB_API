import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingCycleMaster } from '../../billing-cycle/entities/billing-cycle-master.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class BillingCycleSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'BillingCycleSearchProvider';
  private static readonly MODULE_LABEL = 'Billing Management';

  constructor(@InjectRepository(BillingCycleMaster) private readonly masters: Repository<BillingCycleMaster>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_BILLING_CYCLE);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // The master (one per property) is the searchable/identifying row — its own current-version status
    // lives on the related BillingCycleVersion, which has no name/title of its own at all (just
    // frequency/day-offset columns), so the master + its property is what a user would actually
    // recognize a billing cycle by.
    const rows = await applyMultiWordSearch(
      this.masters
        .createQueryBuilder('master')
        .innerJoin('master.property', 'property')
        .leftJoin('master.currentVersion', 'currentVersion')
        .select(['master.id', 'master.businessCode', 'property.name', 'currentVersion.status']),
      ['master.businessCode', 'property.name'],
      term,
    )
      .take(limit)
      .getMany();

    return rows.map((master) => ({
      entityType: 'BILLING_CYCLE',
      id: String(master.id),
      module: BillingCycleSearchProvider.MODULE_LABEL,
      title: master.businessCode ?? `Billing Cycle #${master.id}`,
      description: master.property.name,
      status: humanizeEnumValue(master.currentVersion?.status),
      // No per-record detail route exists today (only a flat /admin/business/billing-cycle/list) — same
      // "land on the list, not a page that doesn't exist" choice as BillSearchProvider.
      url: `/admin/business/billing-cycle/list`,
    }));
  }
}

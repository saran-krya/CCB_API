import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../customer/entities/customer.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class CustomerSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'CustomerSearchProvider';
  private static readonly MODULE_LABEL = 'Customer Management';

  constructor(@InjectRepository(Customer) private readonly customers: Repository<Customer>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_CUSTOMER);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    const rows = await applyMultiWordSearch(
      this.customers.createQueryBuilder('c').select(['c.id', 'c.fullName', 'c.contactEmail', 'c.contactPhone', 'c.accountStatus']),
      ['c.fullName', 'c.contactEmail', 'c.contactPhone'],
      term,
    )
      .orderBy('c.fullName', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((customer) => ({
      entityType: 'CUSTOMER',
      id: String(customer.id),
      module: CustomerSearchProvider.MODULE_LABEL,
      title: customer.fullName,
      description: customer.contactEmail ?? customer.contactPhone ?? undefined,
      status: humanizeEnumValue(customer.accountStatus),
      url: `/customers/${customer.id}`,
    }));
  }
}

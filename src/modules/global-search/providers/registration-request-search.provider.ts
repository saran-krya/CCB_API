import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegistrationRequest } from '../../registration-request/entities/registration-request.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class RegistrationRequestSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'RegistrationRequestSearchProvider';
  private static readonly MODULE_LABEL = 'Registration Requests';

  constructor(@InjectRepository(RegistrationRequest) private readonly requests: Repository<RegistrationRequest>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.VIEW_REGISTRATION_REQUESTS);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // customer is only set once a request reaches approval, so it must be a LEFT join — an INNER join
    // would silently drop every request that has no customer yet. Also searched once joined, so the
    // applicant's own name finds their request too, not only its business code.
    const rows = await applyMultiWordSearch(
      this.requests
        .createQueryBuilder('request')
        .leftJoin('request.customer', 'customer')
        .select(['request.id', 'request.businessCode', 'request.status', 'customer.id', 'customer.fullName']),
      ['request.businessCode', 'customer.fullName'],
      term,
    )
      .orderBy('request.businessCode', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((request) => ({
      entityType: 'REGISTRATION_REQUEST',
      id: String(request.id),
      module: RegistrationRequestSearchProvider.MODULE_LABEL,
      title: request.businessCode ?? `Registration Request #${request.id}`,
      description: request.customer?.fullName,
      status: humanizeEnumValue(request.status),
      url: `/customers/registration-requests/${request.id}`,
    }));
  }
}

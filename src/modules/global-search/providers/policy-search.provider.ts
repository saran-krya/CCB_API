import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Policy } from '../../iam/entities/policy.entity';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class PolicySearchProvider implements GlobalSearchProvider {
  readonly providerName = 'PolicySearchProvider';
  private static readonly MODULE_LABEL = 'Policy Management';

  constructor(@InjectRepository(Policy) private readonly policies: Repository<Policy>) {}

  // Policy Management is @Roles(SUPER_ADMIN)-only on its own controller (policy.controller.ts) — a
  // role check, not an action code (no CREATE_POLICY/VIEW_POLICY action exists in the catalog; granting
  // "manage policies" via a Policy would be circular). Mirrored here exactly, not approximated with an
  // action-code guess.
  isEnabledFor(context: SearchAuthContext): boolean {
    return context.isSuperAdmin;
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    const rows = await applyMultiWordSearch(
      this.policies.createQueryBuilder('policy').select(['policy.id', 'policy.name', 'policy.description', 'policy.isSystem']),
      ['policy.name', 'policy.description'],
      term,
    )
      .orderBy('policy.name', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((policy) => ({
      entityType: 'POLICY',
      id: String(policy.id),
      module: PolicySearchProvider.MODULE_LABEL,
      title: policy.name,
      description: policy.description ?? undefined,
      status: policy.isSystem ? 'System managed' : 'Customer managed',
      url: `/system-admin/policies/view/${policy.id}`,
    }));
  }
}

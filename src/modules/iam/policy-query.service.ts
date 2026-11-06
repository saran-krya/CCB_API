import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { paginate } from '../../common/utils/pagination.util';
import { Role } from '../role/entities/role.entity';
import { Policy, POLICY_TYPE_LABEL } from './entities/policy.entity';
import { PolicyStatement } from './entities/policy-statement.entity';
import { RolePolicy } from './entities/role-policy.entity';
import { PolicyAttachedRolesQueryDto } from './dto/policy-attached-roles-query.dto';
import { PolicyListQueryDto } from './dto/policy-list-query.dto';
import { SORT_ORDER } from '../../common/constants/sort.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';

// How many roles hold the policy — a correlated subquery selected as an alias (never joined), so a page still
// holds one row per policy and TypeORM can order a skip/take page by it.
const ATTACHED_ROLE_COUNT_SQL = `(
  SELECT COUNT(*)
  FROM role_policies rp_att
  WHERE rp_att.policyId = policy.id AND rp_att.deleted_at IS NULL
)`;

// A role the policy is NOT attached to, for the role alias given — a NOT EXISTS over the join table (never a join),
// so a page still holds one row per role. Written out with `deleted_at` like ATTACHED_ROLE_COUNT_SQL above.
const roleNotAttachedSql = (roleAlias: string) => `NOT EXISTS (
  SELECT 1
  FROM role_policies rp_att
  WHERE rp_att.roleId = ${roleAlias}.id AND rp_att.policyId = :policyId AND rp_att.deleted_at IS NULL
)`;

/**
 * Read side of Policy Management: the Policies list, and the roles one policy is / is not attached to, each searched /
 * filtered / sorted / paged here. Everything a row says about itself — its type label, its "Attached roles" text,
 * why it can't be deleted — and the filter options come from this service, so the web client holds none of it.
 * Kept apart from IamService (which owns the writes and the authorization maths) so the list rules stay small.
 */
@Injectable()
export class PolicyQueryService {
  constructor(
    @InjectRepository(Policy) private readonly policies: Repository<Policy>,
    @InjectRepository(PolicyStatement) private readonly statements: Repository<PolicyStatement>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
  ) {}

  async list(query: PolicyListQueryDto) {
    const qb = this.policies.createQueryBuilder('policy').addSelect(ATTACHED_ROLE_COUNT_SQL, 'attached_role_count');

    const term = query['search.query']?.trim();
    if (term) {
      qb.andWhere('(policy.name LIKE :term OR policy.description LIKE :term)', { term: `%${term}%` });
    }
    if (query.type) {
      qb.andWhere('policy.isSystem = :isSystem', { isSystem: query.type === 'system' });
    }
    if (query.attachment) {
      qb.andWhere(`${ATTACHED_ROLE_COUNT_SQL} ${query.attachment === 'attached' ? '> 0' : '= 0'}`);
    }
    if (query.excludeIds?.length) {
      qb.andWhere('policy.id NOT IN (:...excludeIds)', { excludeIds: query.excludeIds });
    }

    const direction = query.sortOrder === SORT_ORDER.DESC ? SORT_ORDER.DESC : SORT_ORDER.ASC;
    const sortColumns = {
      name: 'policy.name',
      type: 'policy.isSystem',
      usedAs: 'attached_role_count',
      description: 'policy.description',
      createdAt: 'policy.createdAt',
    } as const;
    const sortColumn = sortColumns[query.sortBy] ?? sortColumns.name;
    qb.orderBy(sortColumn, direction);
    // Ties fall back to the name so the order never jumps between requests.
    if (sortColumn !== sortColumns.name) qb.addOrderBy('policy.name', SORT_ORDER.ASC);

    const page = await paginate(qb, query);
    const policyIds = page.items.map((policy) => policy.id);
    const [attachedCounts, actionCounts, totalRoles] = await Promise.all([
      this.getAttachedRoleCounts(policyIds),
      this.getActionCounts(policyIds),
      this.roles.count(),
    ]);

    return {
      items: page.items.map((policy) => {
        const attachedRoleCount = attachedCounts.get(policy.id) ?? 0;
        return {
          id: policy.id,
          name: policy.name,
          description: policy.description ?? null,
          isSystem: policy.isSystem,
          typeLabel: policy.isSystem ? POLICY_TYPE_LABEL.system : POLICY_TYPE_LABEL.custom,
          attachedRoleCount,
          // Roles that could still receive this policy — what the Attach page lists. A role's policy links go with it
          // when it is deleted (RoleService.remove), so total roles minus attached is exact.
          availableRoleCount: Math.max(totalRoles - attachedRoleCount, 0),
          usedAsLabel: attachedRoleCount === 0 ? 'None' : `${attachedRoleCount} role${attachedRoleCount === 1 ? '' : 's'}`,
          actionCount: actionCounts.get(policy.id) ?? 0,
          deleteBlockedReason: this.deleteBlockedReason(policy, attachedRoleCount),
        };
      }),
      pagination: page.pagination,
      meta: {
        attachmentOptions: [
          { value: 'attached', label: 'Attached' },
          { value: 'unattached', label: 'Unattached' },
        ],
        typeOptions: [
          { value: 'system', label: POLICY_TYPE_LABEL.system },
          { value: 'custom', label: POLICY_TYPE_LABEL.custom },
        ],
      },
    };
  }

  /** The roles one policy is attached to, as a searchable / filterable / sortable / paged list. The category
   *  filter's options are the categories those roles actually have. */
  attachedRoles(policyId: number, query: PolicyAttachedRolesQueryDto) {
    return this.rolePage(policyId, query, (alias) =>
      this.roles
        .createQueryBuilder(alias)
        .innerJoin(RolePolicy, 'rp', `rp.roleId = ${alias}.id AND rp.policyId = :policyId`, { policyId }),
    );
  }

  /** The roles one policy is NOT attached to — the Attach page's list. Same search / filter / sort / paging and the
   *  same row shape as attachedRoles, so the two pages share one layout; the two lists never hold the same role. */
  availableRoles(policyId: number, query: PolicyAttachedRolesQueryDto) {
    return this.rolePage(policyId, query, (alias) =>
      this.roles.createQueryBuilder(alias).andWhere(roleNotAttachedSql(alias), { policyId }),
    );
  }

  /** One page of a role list scoped to a policy. `scope` builds the base query for a role alias — it runs twice, once
   *  for the page and once for the category options, which come from the roles in scope only. */
  private async rolePage(
    policyId: number,
    query: PolicyAttachedRolesQueryDto,
    scope: (alias: string) => SelectQueryBuilder<Role>,
  ) {
    if (!(await this.policies.exist({ where: { id: policyId } }))) throw new NotFoundException(ERROR_MESSAGES.POLICY_NOT_FOUND);

    const qb = scope('role').leftJoinAndSelect('role.userCategory', 'userCategory');

    const term = query['search.query']?.trim();
    if (term) qb.andWhere('role.roleName LIKE :term', { term: `%${term}%` });
    if (query.userCategoryId) qb.andWhere('role.userCategoryId = :userCategoryId', { userCategoryId: query.userCategoryId });

    const direction = query.sortOrder === SORT_ORDER.DESC ? SORT_ORDER.DESC : SORT_ORDER.ASC;
    qb.orderBy(query.sortBy === 'userCategory' ? 'userCategory.label' : 'role.roleName', direction);
    if (query.sortBy === 'userCategory') qb.addOrderBy('role.roleName', SORT_ORDER.ASC);

    const [page, categoryRows] = await Promise.all([
      paginate(qb, query),
      scope('role')
        .innerJoin('role.userCategory', 'uc')
        .select('uc.id', 'id')
        .addSelect('uc.label', 'label')
        .groupBy('uc.id')
        .addGroupBy('uc.label')
        .getRawMany<{ id: number; label: string }>(),
    ]);

    return {
      items: page.items.map((role) => ({
        id: role.id,
        roleName: role.roleName,
        userCategoryLabel: role.userCategory?.label ?? null,
      })),
      pagination: page.pagination,
      meta: {
        userCategoryOptions: categoryRows
          .map((row) => ({ value: Number(row.id), label: row.label }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
    };
  }

  /** Why this policy can't be deleted, or null when it can be tried (delete itself still enforces every rule). */
  private deleteBlockedReason(policy: Pick<Policy, 'isSystem'>, attachedRoleCount: number): string | null {
    if (policy.isSystem) return 'This policy is system-managed and cannot be deleted.';
    if (attachedRoleCount > 0) {
      return `Attached to ${attachedRoleCount} role${attachedRoleCount === 1 ? '' : 's'} — detach it from every role first.`;
    }
    return null;
  }

  private async getAttachedRoleCounts(policyIds: number[]): Promise<Map<number, number>> {
    if (policyIds.length === 0) return new Map();
    const rows = await this.policies.manager
      .createQueryBuilder(RolePolicy, 'rp')
      .select('rp.policyId', 'policyId')
      .addSelect('COUNT(*)', 'count')
      .where('rp.policyId IN (:...policyIds)', { policyIds })
      .groupBy('rp.policyId')
      .getRawMany<{ policyId: number; count: string }>();
    return new Map(rows.map((row) => [Number(row.policyId), Number(row.count)]));
  }

  /** Distinct action codes a policy grants across all its statements — one query for the page. */
  private async getActionCounts(policyIds: number[]): Promise<Map<number, number>> {
    if (policyIds.length === 0) return new Map();
    const statements = await this.statements.find({ where: { policyId: In(policyIds) } });
    const codesByPolicy = new Map<number, Set<string>>();
    for (const statement of statements) {
      const codes = codesByPolicy.get(statement.policyId) ?? new Set<string>();
      statement.actions.forEach((code) => codes.add(code));
      codesByPolicy.set(statement.policyId, codes);
    }
    return new Map([...codesByPolicy].map(([policyId, codes]) => [policyId, codes.size]));
  }
}

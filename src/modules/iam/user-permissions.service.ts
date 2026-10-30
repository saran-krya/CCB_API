import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ROLES } from '@app/common/constants/global';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../user-role/entities/user-role.entity';
import { UserInlinePolicy } from './entities/user-inline-policy.entity';
import {
  UserPermissionKind,
  UserPermissionSortColumn,
  UserPermissionsQueryDto,
} from './dto/user-permissions-query.dto';

const TYPE_LABEL: Record<UserPermissionKind, string> = { role: 'Role', inline: 'Inline policy' };
// CCB has no groups or inherited assignment: a role is always assigned directly to the user and an inline
// policy always lives on the user — so these are true labels, not invented metadata.
const ATTACHED_VIA: Record<UserPermissionKind, string> = { role: 'Direct assignment', inline: 'Inline' };

export interface UserPermissionRow {
  /** Unique across both kinds ("role:12" / "inline:5"). */
  key: string;
  kind: UserPermissionKind;
  id: number;
  name: string;
  typeLabel: string;
  attachedVia: string;
  /** Roles only. */
  userCategoryLabel: string | null;
}

const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * "What grants this user access": the roles they hold and, for SUPER_ADMIN viewers only, the inline
 * policies attached to them, in ONE searchable / filterable / sortable / paged list (the User Details >
 * Permissions table). A user holds a handful of each, so both sets are read in two small queries and
 * shaped here; the web client sends only the query and renders the returned page.
 *
 * Inline policies are SUPER_ADMIN-only everywhere else (UserInlinePolicyController), so this endpoint
 * applies the identical boundary itself: for anyone else they are neither returned nor offered as a
 * type filter option.
 */
@Injectable()
export class UserPermissionsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(UserInlinePolicy) private readonly inlinePolicies: Repository<UserInlinePolicy>,
  ) {}

  async list(userId: number, query: UserPermissionsQueryDto, actor: AuthenticatedUser) {
    if (!(await this.users.exist({ where: { id: userId } }))) throw new NotFoundException('User not found');

    const canSeeInline = (actor.roleNames ?? [actor.roleName]).includes(ROLES.SUPER_ADMIN);
    const kinds: UserPermissionKind[] = canSeeInline ? ['role', 'inline'] : ['role'];
    // A type the caller can't see is simply an empty list, never an error that reveals it exists.
    const wanted = query.type ? kinds.filter((kind) => kind === query.type) : kinds;

    const [roleRows, inlineRows] = await Promise.all([
      wanted.includes('role') ? this.loadRoleRows(userId) : Promise.resolve([]),
      wanted.includes('inline') ? this.loadInlineRows(userId) : Promise.resolve([]),
    ]);

    const needle = query['search.query']?.trim().toLowerCase();
    const matching = [...roleRows, ...inlineRows].filter(
      (row) =>
        !needle ||
        `${row.name} ${row.typeLabel} ${row.attachedVia} ${row.userCategoryLabel ?? ''}`.toLowerCase().includes(needle),
    );

    const sorted = this.sort(matching, query.sortBy, query.sortOrder);
    const { page, limit } = query;
    const totalPages = Math.max(1, Math.ceil(sorted.length / limit));
    const current = Math.min(page, totalPages);

    return {
      items: sorted.slice((current - 1) * limit, current * limit),
      pagination: { page: current, limit, total: sorted.length, totalPages },
      // The "Filter by Type" options come from here, so the client never hardcodes which kinds exist.
      meta: { typeOptions: kinds.map((kind) => ({ value: kind, label: TYPE_LABEL[kind] })) },
    };
  }

  private async loadRoleRows(userId: number): Promise<UserPermissionRow[]> {
    const rows = await this.userRoles.find({
      where: { userId },
      order: { id: 'ASC' },
      relations: { role: { userCategory: true } },
    });
    // A role soft-deleted after it was assigned joins to null and grants nothing — skipped.
    return rows
      .filter((row) => !!row.role)
      .map((row) => ({
        key: `role:${row.role.id}`,
        kind: 'role' as const,
        id: row.role.id,
        name: row.role.roleName,
        typeLabel: TYPE_LABEL.role,
        attachedVia: ATTACHED_VIA.role,
        userCategoryLabel: row.role.userCategory?.label ?? null,
      }));
  }

  private async loadInlineRows(userId: number): Promise<UserPermissionRow[]> {
    const policies = await this.inlinePolicies.find({ where: { userId }, order: { id: 'ASC' } });
    return policies.map((policy) => ({
      key: `inline:${policy.id}`,
      kind: 'inline' as const,
      id: policy.id,
      name: policy.name,
      typeLabel: TYPE_LABEL.inline,
      attachedVia: ATTACHED_VIA.inline,
      userCategoryLabel: null,
    }));
  }

  private sort(rows: UserPermissionRow[], column: UserPermissionSortColumn, order: 'ASC' | 'DESC') {
    const sign = order === 'DESC' ? -1 : 1;
    const valueOf = (row: UserPermissionRow) =>
      column === 'type' ? row.typeLabel : column === 'attachedVia' ? row.attachedVia : row.name;
    // Ties fall back to the name (then the key) so the order never jumps between requests.
    return [...rows].sort(
      (a, b) => sign * compareText(valueOf(a), valueOf(b)) || compareText(a.name, b.name) || compareText(a.key, b.key),
    );
  }
}

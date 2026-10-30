import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Resource } from './entities/resource.entity';
import { Policy, POLICY_TYPE_LABEL } from './entities/policy.entity';
import { PolicyStatement } from './entities/policy-statement.entity';
import { RolePolicy } from './entities/role-policy.entity';
import { UserInlinePolicy } from './entities/user-inline-policy.entity';
import { RoleInlinePolicy } from './entities/role-inline-policy.entity';
import { Role } from '../role/entities/role.entity';
import { Action } from '../actions/entities/action.entity';
import { RESOURCES } from './resource-catalog';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';
import { AuditService } from '../../audit/audit.service';
import { ROLES } from '@app/common/constants/global';
import { paginate } from '../../common/utils/pagination.util';
import { ActionPresentation, describeAction } from './action-presentation';
import { RolePoliciesQueryDto } from './dto/role-policies-query.dto';

@Injectable()
export class IamService {
  private readonly logger = new Logger(IamService.name);

  constructor(
    @InjectRepository(Resource) private readonly resources: Repository<Resource>,
    @InjectRepository(Policy) private readonly policies: Repository<Policy>,
    @InjectRepository(PolicyStatement) private readonly statements: Repository<PolicyStatement>,
    @InjectRepository(RolePolicy) private readonly rolePolicies: Repository<RolePolicy>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Action) private readonly actions: Repository<Action>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @InjectRepository(UserInlinePolicy) private readonly userInlinePolicies: Repository<UserInlinePolicy>,
    @InjectRepository(RoleInlinePolicy) private readonly roleInlinePolicies: Repository<RoleInlinePolicy>,
  ) {}

  // ── Resource catalog bootstrap (idempotent, same pattern as ActionsService.ensureCriticalDefaults) ──

  async ensureResourceCatalog(): Promise<void> {
    // Two passes: create/update every resource with no parent link first, then wire up
    // parentResourceId, mirroring ActionsService's own parent-after-children approach — a resource's
    // parent must already exist (by id) before it can be referenced.
    const byCode = new Map<string, Resource>();

    for (const seed of RESOURCES) {
      let existing = await this.resources.findOne({ where: { code: seed.code } });
      if (existing) {
        const needsUpdate =
          existing.name !== seed.name ||
          existing.displayOrder !== seed.displayOrder ||
          (existing.description ?? undefined) !== seed.description;
        if (needsUpdate) {
          existing.name = seed.name;
          existing.displayOrder = seed.displayOrder;
          existing.description = seed.description;
          existing = await this.resources.save(existing);
          this.logger.debug(`Corrected resource "${seed.code}" (name/displayOrder/description)`);
        }
      } else {
        existing = await this.resources.save(
          this.resources.create({
            code: seed.code,
            name: seed.name,
            description: seed.description,
            displayOrder: seed.displayOrder,
          }),
        );
        this.logger.debug(`Seeded resource "${seed.code}"`);
      }
      byCode.set(seed.code, existing);
    }

    for (const seed of RESOURCES) {
      if (!seed.parentResourceCode) continue;
      const resource = byCode.get(seed.code)!;
      const parent = byCode.get(seed.parentResourceCode);
      if (!parent) {
        this.logger.warn(`Resource "${seed.code}" skipped parent link — parent "${seed.parentResourceCode}" not found`);
        continue;
      }
      if (resource.parentResourceId !== parent.id) {
        resource.parentResourceId = parent.id;
        await this.resources.save(resource);
      }
    }
  }

  async findAllResources(): Promise<Resource[]> {
    return this.resources.find({ order: { displayOrder: 'ASC' } });
  }

  /** Same catalog as findAllResources, but each row also carries the {code, name} of every ACTIVE
   *  Action it may legally be paired with in a PolicyStatement (per resource-catalog.ts's own
   *  mapping) — read-only, additive, and the only way a frontend policy editor can know which
   *  actions are valid for a given resource without hardcoding the mapping a second time. Does not
   *  change findAllResources's existing shape or any of its call sites. */
  async findAllResourcesWithActions(): Promise<
    (Resource & { availableActions: ({ code: string; name: string } & ActionPresentation)[] })[]
  > {
    const [allResources, allActions] = await Promise.all([
      this.resources.find({ order: { displayOrder: 'ASC' } }),
      this.actions.find({ where: { isActive: true } }),
    ]);
    const actionByCode = new Map(allActions.map((a) => [a.code, a]));
    const resourceCatalogByCode = new Map(RESOURCES.map((r) => [r.code, r.actionCodes]));

    return allResources.map((resource) => {
      const codes = resourceCatalogByCode.get(resource.code) ?? [];
      const availableActions = codes
        .map((code) => actionByCode.get(code))
        .filter((a): a is Action => !!a)
        .map((a) => ({ code: a.code, name: a.name, ...describeAction(a.code, a.name) }));
      return Object.assign(resource, { availableActions });
    });
  }

  // ── Policy validation ──────────────────────────────────────────────────────────────────────────

  /** Validates every statement's resourceCode against the real Resource catalog and every
   *  actionCode against the real Action catalog AND confirms the action actually belongs to that
   *  resource (per resource-catalog.ts's own mapping) — rejects any invalid or incompatible
   *  combination rather than silently accepting a typo or a cross-resource mismatch. Returns the
   *  resolved {resourceId, actionCodes} pairs ready to persist. Public so the user inline-policy
   *  service validates against exactly the same catalog rules as shared Policies. */
  async validateStatements(
    dtoStatements: { resourceCode: string; actionCodes: string[] }[],
  ): Promise<{ resourceId: number; actions: string[] }[]> {
    const allResources = await this.resources.find();
    const resourceByCode = new Map(allResources.map((r) => [r.code, r]));
    const allActions = await this.actions.find({ where: { isActive: true } });
    const actionByCode = new Map(allActions.map((a) => [a.code, a]));

    const resourceCatalogByCode = new Map(RESOURCES.map((r) => [r.code, new Set(r.actionCodes)]));

    const resolved: { resourceId: number; actions: string[] }[] = [];
    const seenResourceCodes = new Set<string>();

    for (const statement of dtoStatements) {
      const resource = resourceByCode.get(statement.resourceCode);
      if (!resource) {
        throw new BadRequestException(`Unknown resource code "${statement.resourceCode}"`);
      }
      if (seenResourceCodes.has(statement.resourceCode)) {
        throw new BadRequestException(`Resource "${statement.resourceCode}" appears in more than one statement — combine its actions into a single statement instead`);
      }
      seenResourceCodes.add(statement.resourceCode);

      const validActionsForResource = resourceCatalogByCode.get(statement.resourceCode) ?? new Set<string>();
      const uniqueActionCodes = [...new Set(statement.actionCodes)];

      for (const actionCode of uniqueActionCodes) {
        if (!actionByCode.has(actionCode)) {
          throw new BadRequestException(`Unknown action code "${actionCode}"`);
        }
        if (!validActionsForResource.has(actionCode)) {
          throw new BadRequestException(`Action "${actionCode}" does not belong to resource "${statement.resourceCode}"`);
        }
      }

      resolved.push({ resourceId: resource.id, actions: uniqueActionCodes });
    }

    return resolved;
  }

  async createPolicy(dto: CreatePolicyDto, actorId?: number): Promise<Policy> {
    const existing = await this.policies.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A policy with this name already exists');

    const resolvedStatements = await this.validateStatements(dto.statements);

    return this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(Policy);
      const statementRepo = manager.getRepository(PolicyStatement);

      const policy = await policyRepo.save(
        policyRepo.create({ name: dto.name, description: dto.description }),
      );

      const statementRows = resolvedStatements.map((s) =>
        statementRepo.create({ policyId: policy.id, resourceId: s.resourceId, effect: 'Allow', actions: s.actions }),
      );
      await statementRepo.save(statementRows);

      await this.audit.record(
        { moduleName: 'policies', entityId: policy.id, action: 'CREATE', newValue: { name: policy.name, statements: dto.statements }, performedBy: actorId },
        manager,
      );

      return this.findOnePolicy(policy.id, manager);
    });
  }

  /**
   * System-managed policies (Policy.isSystem — currently only the boot-generated SUPER_ADMIN
   * Policy, see IamService.ensureAdminPolicyGrants) can never be edited through this API, regardless
   * of who's calling or what name the policy currently has — checked against the persisted flag,
   * never the policy's name/id, so a system policy that gets renamed is still protected. The
   * automatic grant-sync in ensureAdminPolicyGrants is unaffected: it writes directly via the
   * statements/policies repositories, never through this method.
   */
  async updatePolicy(id: number, dto: UpdatePolicyDto, actorId?: number): Promise<Policy> {
    const policy = await this.policies.findOne({ where: { id } });
    if (!policy) throw new NotFoundException('Policy not found');

    if (policy.isSystem) {
      throw new ForbiddenException('This policy is system-managed and cannot be edited.');
    }

    const nameConflict = await this.policies.findOne({ where: { name: dto.name } });
    if (nameConflict && nameConflict.id !== id) throw new ConflictException('A policy with this name already exists');

    const resolvedStatements = await this.validateStatements(dto.statements);
    const oldStatements = await this.statements.find({ where: { policyId: id } });

    return this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(Policy);
      const statementRepo = manager.getRepository(PolicyStatement);

      policy.name = dto.name;
      policy.description = dto.description;
      await policyRepo.save(policy);

      await statementRepo.delete({ policyId: id });
      const statementRows = resolvedStatements.map((s) =>
        statementRepo.create({ policyId: id, resourceId: s.resourceId, effect: 'Allow', actions: s.actions }),
      );
      await statementRepo.save(statementRows);

      await this.audit.record(
        {
          moduleName: 'policies',
          entityId: id,
          action: 'UPDATE',
          oldValue: { statements: oldStatements.map((s) => ({ resourceId: s.resourceId, actions: s.actions })) },
          newValue: { statements: dto.statements },
          performedBy: actorId,
        },
        manager,
      );

      return this.findOnePolicy(id, manager);
    });
  }

  async findAllPolicies(): Promise<Policy[]> {
    return this.policies.find({ relations: { statements: { resource: true } }, order: { name: 'ASC' } });
  }

  async findOnePolicy(id: number, manager = this.dataSource.manager): Promise<Policy> {
    const policy = await manager.getRepository(Policy).findOne({
      where: { id },
      relations: { statements: { resource: true } },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  /**
   * System-managed policies can never be deleted through this API — checked first, before the
   * ordinary "still attached to N role(s)" guard below, so the error always names the real reason
   * (system-managed, not "detach it first") even for a system policy that happens to be unattached.
   */
  async removePolicy(id: number, actorId?: number): Promise<{ message: string }> {
    const policy = await this.policies.findOne({ where: { id } });
    if (!policy) throw new NotFoundException('Policy not found');

    if (policy.isSystem) {
      throw new ForbiddenException('This policy is system-managed and cannot be deleted.');
    }

    const attachedCount = await this.rolePolicies.count({ where: { policyId: id } });
    if (attachedCount > 0) {
      throw new ConflictException(
        `This policy is attached to ${attachedCount} role(s) — detach it from every role before deleting`,
      );
    }

    await this.policies.softRemove(policy);
    await this.audit.record({ moduleName: 'policies', entityId: id, action: 'DELETE', oldValue: policy, performedBy: actorId });
    return { message: 'Policy deleted successfully' };
  }

  // ── Role <-> Policy attachment ─────────────────────────────────────────────────────────────────

  /** The role's attached policies, each with `attachedRoleCount` — how many roles (this one included) hold it,
   *  from one grouped query — so the attach/remove screen can show it without a request per policy. */
  async getPoliciesForRole(roleId: number): Promise<(Policy & { attachedRoleCount: number })[]> {
    const rows = await this.rolePolicies.find({ where: { roleId }, relations: { policy: { statements: { resource: true } } } });
    const policies = rows.map((r) => r.policy!).filter(Boolean);
    if (policies.length === 0) return [];
    const countByPolicyId = new Map((await this.getRoleCountsByPolicy()).map((row) => [row.policyId, row.count]));
    return policies.map((policy) => Object.assign(policy, { attachedRoleCount: countByPolicyId.get(policy.id) ?? 0 }));
  }

  /** The policies attached to ONE role as a searchable / filterable / sortable / paged list (the Role details
   *  page's "Permissions policies" table). `isSystem` is the persisted flag — never inferred from a name — and
   *  the Type filter's options come back in `meta`, so the client hardcodes neither. Attached-entities is a
   *  correlated subquery exposed as an alias (no join on the many side, so a page holds one row per policy). */
  async getPoliciesForRolePage(roleId: number, query: RolePoliciesQueryDto) {
    if (!(await this.roles.exist({ where: { id: roleId } }))) throw new NotFoundException('Role not found');

    const qb = this.policies
      .createQueryBuilder('policy')
      .innerJoin(RolePolicy, 'rp', 'rp.policyId = policy.id AND rp.roleId = :roleId', { roleId })
      .addSelect(
        `(
          SELECT COUNT(*)
          FROM role_policies rp_att
          WHERE rp_att.policyId = policy.id AND rp_att.deleted_at IS NULL
        )`,
        'attached_entities',
      );

    const term = query['search.query']?.trim();
    if (term) {
      qb.andWhere('(policy.name LIKE :term OR policy.description LIKE :term)', { term: `%${term}%` });
    }
    if (query.type) {
      qb.andWhere('policy.isSystem = :isSystem', { isSystem: query.type === 'system' });
    }

    const direction = query.sortOrder === 'DESC' ? 'DESC' : 'ASC';
    const sortColumn =
      query.sortBy === 'attachedEntities' ? 'attached_entities' : query.sortBy === 'type' ? 'policy.isSystem' : 'policy.name';
    qb.orderBy(sortColumn, direction);
    // Ties fall back to the name so the order never jumps between requests.
    if (sortColumn !== 'policy.name') qb.addOrderBy('policy.name', 'ASC');

    const page = await paginate(qb, query);
    const counts = await this.getRoleCountsByPolicy();
    const countByPolicyId = new Map(counts.map((row) => [row.policyId, row.count]));

    return {
      items: page.items.map((policy) => ({
        id: policy.id,
        name: policy.name,
        description: policy.description ?? null,
        isSystem: policy.isSystem,
        typeLabel: policy.isSystem ? POLICY_TYPE_LABEL.system : POLICY_TYPE_LABEL.custom,
        attachedRoleCount: countByPolicyId.get(policy.id) ?? 0,
      })),
      pagination: page.pagination,
      meta: {
        typeOptions: [
          { value: 'system', label: POLICY_TYPE_LABEL.system },
          { value: 'custom', label: POLICY_TYPE_LABEL.custom },
        ],
      },
    };
  }

  /** Reverse of getPoliciesForRole — every Role this one Policy is attached to, with just enough
   *  Role identity (id, roleName) for the Policy Details page's "Attached roles" list. Read-only,
   *  additive; does not affect getPoliciesForRole or any other existing call site. */
  async getRolesForPolicy(policyId: number): Promise<{ id: number; roleName: string }[]> {
    const rows = await this.rolePolicies.find({ where: { policyId }, relations: { role: true } });
    return rows.map((r) => r.role!).filter(Boolean).map((r) => ({ id: r.id, roleName: r.roleName }));
  }

  /** Bulk, one-query variant of getPoliciesForRole's count — lets the Roles list show "N policies
   *  attached" per row without an N+1 request per role. Read-only, additive; does not affect
   *  getPoliciesForRole or any other existing call site. */
  async getPolicyCountsByRole(): Promise<{ roleId: number; count: number }[]> {
    const rows = await this.rolePolicies
      .createQueryBuilder('rp')
      .select('rp.roleId', 'roleId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('rp.roleId')
      .getRawMany<{ roleId: number; count: string }>();
    return rows.map((r) => ({ roleId: Number(r.roleId), count: Number(r.count) }));
  }

  /** Mirror of getPolicyCountsByRole, grouped the other direction — lets the Policies list show
   *  "attached to N role(s)" per row without an N+1 request per policy. Read-only, additive. */
  async getRoleCountsByPolicy(): Promise<{ policyId: number; count: number }[]> {
    const rows = await this.rolePolicies
      .createQueryBuilder('rp')
      .select('rp.policyId', 'policyId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('rp.policyId')
      .getRawMany<{ policyId: number; count: string }>();
    return rows.map((r) => ({ policyId: Number(r.policyId), count: Number(r.count) }));
  }

  async attachPolicyToRole(roleId: number, policyId: number, actorId?: number): Promise<void> {
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    const policy = await this.policies.findOne({ where: { id: policyId } });
    if (!policy) throw new NotFoundException('Policy not found');

    const existing = await this.rolePolicies.findOne({ where: { roleId, policyId } });
    if (existing) return; // already attached — idempotent, not an error

    await this.rolePolicies.save(this.rolePolicies.create({ roleId, policyId }));
    await this.audit.record({
      moduleName: 'role_policies',
      entityId: roleId,
      action: 'ATTACH_POLICY',
      newValue: { policyId, policyName: policy.name },
      performedBy: actorId,
    });
  }

  async detachPolicyFromRole(roleId: number, policyId: number, actorId?: number): Promise<void> {
    const existing = await this.rolePolicies.findOne({ where: { roleId, policyId } });
    if (!existing) return; // already detached — idempotent, not an error

    // SUPER_ADMIN must keep every active, supported permission auto-granted at all times
    // (ensureAdminPolicyGrants reconciles this on every boot, but only ever ADDS missing grants —
    // it never re-attaches a Policy someone manually detached in between restarts). Detaching ANY
    // policy from this one ROLE, regardless of which policy, is never a safe/supported action.
    //
    // Deliberately NOT a general "system-managed policies can never be detached from any role"
    // rule — a system-managed Policy (Policy.isSystem) MAY be attached to, and later detached from,
    // an ordinary (non-SUPER_ADMIN) role; isSystem only protects the Policy's own name/description/
    // statements (see updatePolicy/removePolicy) and this one specific role's grant, never every
    // role-attachment the policy happens to have.
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (role?.roleName === ROLES.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Cannot detach a policy from SUPER_ADMIN — it must always retain full access.',
      );
    }

    await this.rolePolicies.remove(existing);
    await this.audit.record({
      moduleName: 'role_policies',
      entityId: roleId,
      action: 'DETACH_POLICY',
      oldValue: { policyId },
      performedBy: actorId,
    });
  }

  // ── Authorization resolution — the methods PermissionGuard's Policy-aware path calls ────────────

  /** Resolves every Action code a USER holds across ALL of the given (current) roles via their
   *  attached Policies' statements AND each of those roles' own inline policies — plus, when `userId`
   *  is given, that user's OWN inline policies too — the ONE implementation behind every authorization
   *  read in this codebase; the single-role methods below are thin wrappers over it. Three queries at
   *  most (`roleId IN (...)` for attached Policies, `roleId IN (...)` for role-level inline policies,
   *  and the user's own inline policies, all run in parallel), returned as a plain Set for O(1)
   *  lookup, never re-queried per action code within one request. An empty (or all-invalid) `roleIds`
   *  with no valid `userId` resolves to an empty Set WITHOUT querying: a user with no roles holds
   *  nothing.
   *
   *  Semantics (deliberately trivial): purely ADDITIVE, deny by default. The result is the UNION, over
   *  every given role, of (a) the action codes of every `Allow` statement of every Policy attached to
   *  that role, and (b) the action codes of every `Allow` statement of that role's OWN inline policies
   *  (reached by every one of its current holders, exactly as if attached directly to them) — plus the
   *  action codes of every `Allow` statement of the user's own inline policies — nothing else.
   *  PolicyStatement.effect is hard-coded to 'Allow' (nothing can write another value), so conflicting
   *  grants are impossible by construction and there is no Deny or priority machinery to evaluate. It
   *  follows that:
   *   - a statement whose effect is not 'Allow' contributes NOTHING — it is skipped defensively and
   *     never read as a Deny that could subtract a grant another role makes;
   *   - a role with no Policies/inline policies, or none granting a given code, never removes that
   *     code from a user whose other role (or inline policy, role- or user-level) grants it;
   *   - holding more roles, attached Policies, or inline policies (role- or user-level) can only ever
   *     ADD codes, and only ones some statement lists explicitly (no implicit escalation).
   *
   *  Never cached. Callers pass the LIVE role ids JwtStrategy re-reads from user_roles on every
   *  request (never a role claim from the JWT) and the authenticated user's id, so a role, Policy, or
   *  (role- or user-level) inline-policy change applies on the very next request. `userId` is
   *  deliberately optional: a question about ROLES alone (role configuration checks) never includes
   *  any user's own inline policies — it still includes those roles' OWN inline policies, since those
   *  are part of what the role itself grants, not something scoped to a particular user. */
  async getActionCodesGrantedByPoliciesForRoles(roleIds: number[], userId?: number): Promise<Set<string>> {
    // Anything that is not a real id is dropped up front, so an invalid id always means "no grants":
    // TypeORM reads an `undefined` where-value as "no condition", so a bare `where: { roleId }` with
    // a missing id (a principal without a role) would match EVERY role's Policies.
    const validRoleIds = [...new Set(roleIds.filter((id) => Number.isInteger(id) && id > 0))];
    const validUserId = typeof userId === 'number' && Number.isInteger(userId) && userId > 0 ? userId : undefined;
    if (validRoleIds.length === 0 && validUserId === undefined) return new Set();

    const [roleRows, roleInlinePolicies, userInlinePolicies] = await Promise.all([
      validRoleIds.length > 0
        ? this.rolePolicies.find({
            where: { roleId: In(validRoleIds) },
            relations: { policy: { statements: true } },
          })
        : Promise.resolve([] as RolePolicy[]),
      validRoleIds.length > 0
        ? this.roleInlinePolicies.find({ where: { roleId: In(validRoleIds) }, relations: { statements: true } })
        : Promise.resolve([] as RoleInlinePolicy[]),
      validUserId !== undefined
        ? this.userInlinePolicies.find({ where: { userId: validUserId }, relations: { statements: true } })
        : Promise.resolve([] as UserInlinePolicy[]),
    ]);

    const codes = new Set<string>();
    for (const row of roleRows) {
      for (const statement of row.policy?.statements ?? []) {
        if (statement.effect !== 'Allow') continue; // defensive — nothing ever writes a non-Allow value in this phase
        for (const code of statement.actions) codes.add(code);
      }
    }
    for (const roleInline of roleInlinePolicies) {
      for (const statement of roleInline.statements ?? []) {
        if (statement.effect !== 'Allow') continue;
        for (const code of statement.actions) codes.add(code);
      }
    }
    for (const inline of userInlinePolicies) {
      for (const statement of inline.statements ?? []) {
        if (statement.effect !== 'Allow') continue;
        for (const code of statement.actions) codes.add(code);
      }
    }
    return codes;
  }

  /** True iff ANY of the given roles (or, when `userId` is given, that user's own inline policies)
   *  grants `actionCode` — see getActionCodesGrantedByPoliciesForRoles for the exact (additive-union)
   *  semantics. */
  async rolesHaveActionViaPolicy(roleIds: number[], actionCode: string, userId?: number): Promise<boolean> {
    const codes = await this.getActionCodesGrantedByPoliciesForRoles(roleIds, userId);
    return codes.has(actionCode);
  }

  /** Single-role form of getActionCodesGrantedByPoliciesForRoles, for a question about one ROLE (e.g.
   *  ensureAdminPolicyGrants' self-check) — never for authorizing a user's own request, which must
   *  use the multi-role form with the user's live role set. */
  async getActionCodesGrantedByPolicies(roleId: number): Promise<Set<string>> {
    return this.getActionCodesGrantedByPoliciesForRoles([roleId]);
  }

  async roleHasActionViaPolicy(roleId: number, actionCode: string): Promise<boolean> {
    return this.rolesHaveActionViaPolicy([roleId], actionCode);
  }

  /** The Policy-model counterpart to RolePermissionsService.ensureAdminGrants — keeps SUPER_ADMIN's
   *  (and ADMIN's, if a distinct role exists) attached Policy in sync with every active,
   *  Resource-mapped Action code. Necessary because real authorization now resolves exclusively
   *  through Policies (roleHasActionViaPolicy) — without this, an Action added to seed-data.ts after
   *  the one-time IAM backfill migration is auto-"granted" in the legacy tree by ensureAdminGrants
   *  but never reaches SUPER_ADMIN/ADMIN's real, enforced Policy, silently leaving the admin role
   *  unable to use its own endpoints.
   *
   *  SUPER_ADMIN is the application's root/owner account and gets EVERY active action, full stop —
   *  `excludedActionCodesForAdmin` is never applied to it. It still applies to ADMIN (if a distinct
   *  role exists): per explicit instruction, SUPER_ADMIN's own full-access requirement must never
   *  silently broaden what ADMIN gets handed automatically — Finance/approval/workflow-approver-
   *  management capabilities for ADMIN still require an explicit grant via its own Policy. This is
   *  scoped to the Policy model only (not RolePermissionsService.ensureAdminGrants' legacy-tree
   *  equivalent) since the legacy tree is no longer consulted for any real authorization decision —
   *  only Policies are.
   *
   *  Creates the role's own system-managed Policy (named "<RoleName> Policy", matching
   *  AddIamPolicyBackfill's own naming convention) and attaches it if one doesn't exist yet — this is
   *  the ONLY case that happens on a genuinely fresh install: that migration only backfills a Policy
   *  for a role that already had legacy role_permissions rows at the time it ran, and on a brand-new
   *  database migrations run (via `migrationsRun: true`) BEFORE bootstrap's seed() has created any
   *  Role/RolePermission rows at all — so without this, SUPER_ADMIN would boot with zero Policy
   *  grants on a fresh install, and the frontend's Policy-based sidebar/action gating would show
   *  nothing for it. On every other boot (the Policy already exists, from either this method's own
   *  prior run or a successful backfill-migration run) this only FILLS GAPS — adds a missing action
   *  to a resource's existing statement, or a new statement for a resource not yet covered — never
   *  removes a grant, so a manual revocation via the Policy editor is never silently undone.
   *  Idempotent and safe to run on every boot, same as ensureResourceCatalog. */
  async ensureAdminPolicyGrants(excludedActionCodesForAdmin: string[] = []): Promise<void> {
    const adminRoles = await this.roles.find({ where: [{ roleName: 'SUPER_ADMIN' }, { roleName: 'ADMIN' }] });
    if (adminRoles.length === 0) return;

    const [activeActions, allResources] = await Promise.all([
      this.actions.find({ where: { isActive: true } }),
      this.resources.find(),
    ]);
    const activeCodeSet = new Set(activeActions.map((a) => a.code));
    const resourceRowByCode = new Map(allResources.map((r) => [r.code, r]));

    // resourceCode -> every currently-active action code it has, BEFORE any role-specific exclusion
    // is applied below (per role, inside the loop — SUPER_ADMIN excludes nothing; ADMIN still
    // excludes excludedActionCodesForAdmin).
    const activeByResourceCode = new Map<string, Set<string>>();
    for (const resource of RESOURCES) {
      const active = resource.actionCodes.filter((code) => activeCodeSet.has(code));
      if (active.length > 0) activeByResourceCode.set(resource.code, new Set(active));
    }

    for (const role of adminRoles) {
      const excluded = role.roleName === 'SUPER_ADMIN' ? new Set<string>() : new Set(excludedActionCodesForAdmin);
      const grantableByResourceCode = new Map<string, Set<string>>();
      for (const [resourceCode, activeCodes] of activeByResourceCode) {
        const grantable = [...activeCodes].filter((code) => !excluded.has(code));
        if (grantable.length > 0) grantableByResourceCode.set(resourceCode, new Set(grantable));
      }

      let rolePolicyRows = await this.rolePolicies.find({
        where: { roleId: role.id },
        relations: { policy: { statements: true } },
      });

      // ONLY the SUPER_ADMIN Policy is system-managed/protected — this loop also creates an "ADMIN
      // Policy" for the ADMIN role, which remains an ordinary, fully editable Policy (the task this
      // flag backs is scoped exclusively to SUPER_ADMIN's own policy; see Policy.isSystem's own doc
      // comment). isSystem is set here and ONLY here — never via CreatePolicyDto/UpdatePolicyDto.
      const isSuperAdminRole = role.roleName === 'SUPER_ADMIN';

      if (rolePolicyRows.length === 0) {
        const policyName = `${role.roleName} Policy`;
        // Defensive: reuse a Policy already named this (e.g. a prior partial run, or one the
        // backfill migration created for a different role entirely before this role existed) rather
        // than failing on the unique-name constraint.
        let policy = await this.policies.findOne({ where: { name: policyName } });
        if (!policy) {
          policy = await this.policies.save(
            this.policies.create({
              name: policyName,
              description: isSuperAdminRole
                ? `System policy granting "${role.roleName}" every active, supported resource and action. ` +
                  'It is kept in sync automatically and is protected: it cannot be edited, deleted, or ' +
                  'detached from any role through the API. Missing permissions are added automatically, never removed.'
                : `Policy granting "${role.roleName}" every active, supported resource and action. ` +
                  'It is kept in sync automatically, which only ever adds a missing permission and never ' +
                  'removes one you revoke here. Edit freely.',
              isSystem: isSuperAdminRole,
            }),
          );
        } else if (isSuperAdminRole && !policy.isSystem) {
          // Backfill safety net for an environment that somehow still has an unflagged SUPER_ADMIN
          // Policy row at this point (the migration already backfills by name — this covers the
          // fresh-install race where ensureAdminPolicyGrants's own "reuse a Policy already named
          // this" branch runs before any migration-driven backfill could apply).
          policy.isSystem = true;
          policy = await this.policies.save(policy);
        }
        await this.rolePolicies.save(this.rolePolicies.create({ roleId: role.id, policyId: policy.id }));
        this.logger.log(
          `ensureAdminPolicyGrants: created "${policyName}" and attached it to "${role.roleName}" — no Policy ` +
            'existed yet (expected on a fresh install, before the role has any legacy grants for the one-time ' +
            'backfill migration to carry forward)',
        );
        rolePolicyRows = await this.rolePolicies.find({
          where: { roleId: role.id },
          relations: { policy: { statements: true } },
        });
      }

      const primaryPolicy = rolePolicyRows[0].policy!;

      // Same backfill safety net as the fresh-install branch above — covers an environment where the
      // migration's name-based backfill hasn't run yet (or this policy was renamed away from
      // "SUPER_ADMIN Policy" after that backfill, though renaming it is itself now blocked by
      // updatePolicy's own isSystem guard once this flag is set).
      if (isSuperAdminRole && !primaryPolicy.isSystem) {
        primaryPolicy.isSystem = true;
        await this.policies.save(primaryPolicy);
      }

      // The union of what's ALREADY granted across EVERY Policy attached to this role — not just the
      // primary one (a role can have more than one Policy attached; see AttachPolicyDto) — so a code
      // some other attached Policy already covers is never redundantly re-granted into the primary
      // Policy's own statements too. Writes themselves still land only in the primary Policy.
      const alreadyGranted = new Set<string>();
      for (const row of rolePolicyRows) {
        for (const statement of row.policy?.statements ?? []) {
          if (statement.effect !== 'Allow') continue;
          for (const code of statement.actions) alreadyGranted.add(code);
        }
      }

      const statementByResourceId = new Map((primaryPolicy.statements ?? []).map((s) => [s.resourceId, s]));
      let changed = false;

      for (const [resourceCode, grantableCodes] of grantableByResourceCode) {
        const resourceRow = resourceRowByCode.get(resourceCode);
        if (!resourceRow) continue;

        const missing = [...grantableCodes].filter((c) => !alreadyGranted.has(c));
        if (missing.length === 0) continue;

        const existingStatement = statementByResourceId.get(resourceRow.id);
        if (existingStatement) {
          existingStatement.actions = [...existingStatement.actions, ...missing];
          await this.statements.save(existingStatement);
          changed = true;
        } else {
          const created = this.statements.create({
            policyId: primaryPolicy.id,
            resourceId: resourceRow.id,
            effect: 'Allow',
            actions: missing,
          });
          await this.statements.save(created);
          changed = true;
        }
      }

      if (!changed) continue;

      // Re-read and self-verify, matching this codebase's own established migration pattern — throw
      // (and let the caller's try/catch log it, same as every other boot-time ensure* call) rather
      // than silently leave a partially-synced admin Policy.
      const refreshed = await this.getActionCodesGrantedByPolicies(role.id);
      const stillMissing = [...grantableByResourceCode.values()]
        .flatMap((codes) => [...codes])
        .filter((code) => !refreshed.has(code));
      if (stillMissing.length > 0) {
        throw new Error(
          `ensureAdminPolicyGrants self-check failed for role "${role.roleName}": still missing ${stillMissing.join(', ')}`,
        );
      }
      this.logger.log(`ensureAdminPolicyGrants: synced "${role.roleName}"'s Policy with the active Resource/Action catalog`);
    }
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
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
import { releaseSoftDeletedUnique } from '../../common/utils/release-soft-deleted-unique';
import { ActionPresentation, describeAction } from './action-presentation';
import { RolePoliciesQueryDto } from './dto/role-policies-query.dto';
import { APPROVE_ACTION_CODES, BUSINESS_APPROVAL_ACTION_CODES } from './business-approval-actions';
import { MYSQL_ERROR_CODE } from '../../common/constants/database.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { AUDIT_MODULE, AUDIT_ACTION } from '../../audit/audit.constants';
import { POLICY_EFFECT } from './iam.constants';
import { OrganizationContextService } from '../../common/organization-context/organization-context.service';

// Every code that lets a role approve some workflow — what a role must keep while it is a configured approver.
const WORKFLOW_APPROVE_CODES: ReadonlySet<string> = new Set(Object.values(APPROVE_ACTION_CODES).flat());

// The stored description of the system-managed SUPER_ADMIN policy (the `policies.description` column holds 500 chars).
const SUPER_ADMIN_POLICY_DESCRIPTION =
  'System policy granting "SUPER_ADMIN" every active, supported resource and action except business-transaction ' +
  'approvals: SUPER_ADMIN administers the system and does not approve tariffs, billing cycles, bill runs, ' +
  'registration requests or meter readings. It is kept in sync automatically and is protected: it cannot be ' +
  'edited, deleted, or detached from any role through the API.';

// Same MySQL duplicate-key idiom UserRoleService uses for its own unique-index race.
const isDuplicateKeyError = (err: unknown): boolean =>
  /duplicate entry/i.test(err instanceof Error ? err.message : '') ||
  (err as { code?: string; driverError?: { code?: string } })?.code === MYSQL_ERROR_CODE.DUP_ENTRY ||
  (err as { driverError?: { code?: string } })?.driverError?.code === MYSQL_ERROR_CODE.DUP_ENTRY;

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
    private readonly context: OrganizationContextService,
  ) {}

  /** Same "organization-scoped, including the platform SUPER_ADMIN's own null case" posture as
   *  RoleService.applyOrganizationFilter — see that method's own doc comment for why `=` would
   *  silently never match a NULL column. */
  private organizationWhere(): Record<string, unknown> {
    const organizationId = this.context.getOrganizationId();
    return organizationId === null ? { organizationId: IsNull() } : { organizationId };
  }

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
    return this.resources.find({ order: { displayOrder: SORT_ORDER.ASC } });
  }

  /** Same catalog as findAllResources, but each row also carries the {code, name} of every ACTIVE
   *  Action it may legally be paired with in a PolicyStatement (per resource-catalog.ts's own
   *  mapping) — read-only, additive, and the only way a frontend policy editor can know which
   *  actions are valid for a given resource without hardcoding the mapping a second time. Does not
   *  change findAllResources's existing shape or any of its call sites. */
  async findAllResourcesWithActions(): Promise<
    (Resource & { availableActions: ({ code: string; name: string; description: string | null } & ActionPresentation)[] })[]
  > {
    const [allResources, allActions] = await Promise.all([
      this.resources.find({ order: { displayOrder: SORT_ORDER.ASC } }),
      this.actions.find({ where: { isActive: true } }),
    ]);
    const actionByCode = new Map(allActions.map((a) => [a.code, a]));
    const resourceCatalogByCode = new Map(RESOURCES.map((r) => [r.code, r.actionCodes]));

    return allResources.map((resource) => {
      const codes = resourceCatalogByCode.get(resource.code) ?? [];
      const availableActions = codes
        .map((code) => actionByCode.get(code))
        .filter((a): a is Action => !!a)
        // `description` is what the editor's per-action "Info" shows (the action's own seeded explanation).
        .map((a) => ({ code: a.code, name: a.name, description: a.description ?? null, ...describeAction(a.code, a.name) }));
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
    const organizationId = this.context.getOrganizationId();
    if (organizationId === null) {
      throw new ForbiddenException('Creating a policy requires an organization context.');
    }

    // Uniqueness is organization-scoped (see the migration that replaced the old global unique index) —
    // two different organizations may each have their own policy of the same name.
    const existing = await this.policies.findOne({ where: { name: dto.name, organizationId } });
    if (existing) throw new ConflictException(ERROR_MESSAGES.POLICY_NAME_ALREADY_EXISTS);

    const resolvedStatements = await this.validateStatements(dto.statements);

    return this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(Policy);
      const statementRepo = manager.getRepository(PolicyStatement);

      // A deleted policy keeps its name reserved at the unique index; free it so the name is reusable.
      await releaseSoftDeletedUnique(manager, Policy, 'name', dto.name, { keepChars: 120 });
      const policy = await policyRepo.save(
        policyRepo.create({ name: dto.name, description: dto.description, organizationId }),
      );

      const statementRows = resolvedStatements.map((s) =>
        statementRepo.create({ policyId: policy.id, resourceId: s.resourceId, effect: POLICY_EFFECT.ALLOW, actions: s.actions, organizationId }),
      );
      await statementRepo.save(statementRows);

      await this.audit.record(
        { moduleName: AUDIT_MODULE.POLICIES, entityId: policy.id, action: AUDIT_ACTION.CREATE, newValue: { name: policy.name, statements: dto.statements }, performedBy: actorId },
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
    // A policy belonging to a different organization is reported exactly like one that doesn't exist —
    // never a 403, which would confirm its existence to someone who shouldn't know about it.
    if (!policy || policy.organizationId !== this.context.getOrganizationId()) {
      throw new NotFoundException(ERROR_MESSAGES.POLICY_NOT_FOUND);
    }

    if (policy.isSystem) {
      throw new ForbiddenException('This policy is system-managed and cannot be edited.');
    }

    const nameConflict = await this.policies.findOne({ where: { name: dto.name, ...this.organizationWhere() } });
    if (nameConflict && nameConflict.id !== id) throw new ConflictException(ERROR_MESSAGES.POLICY_NAME_ALREADY_EXISTS);

    const resolvedStatements = await this.validateStatements(dto.statements);
    const oldStatements = await this.statements.find({ where: { policyId: id } });

    // An edit must not hand business-approval codes to SUPER_ADMIN through a role this policy is attached to.
    const newApprovalCodes = resolvedStatements.flatMap((s) => s.actions).filter((code) => BUSINESS_APPROVAL_ACTION_CODES.has(code));
    if (newApprovalCodes.length > 0) {
      const attachments = await this.rolePolicies.find({ where: { policyId: id } });
      await this.assertNoBusinessApprovalForSuperAdmin(newApprovalCodes, { roleIds: attachments.map((a) => a.roleId) });
    }

    return this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(Policy);
      const statementRepo = manager.getRepository(PolicyStatement);

      await releaseSoftDeletedUnique(manager, Policy, 'name', dto.name, { keepChars: 120, exceptId: id });
      policy.name = dto.name;
      policy.description = dto.description;
      await policyRepo.save(policy);

      await statementRepo.delete({ policyId: id });
      const statementRows = resolvedStatements.map((s) =>
        statementRepo.create({ policyId: id, resourceId: s.resourceId, effect: POLICY_EFFECT.ALLOW, actions: s.actions, organizationId: policy.organizationId }),
      );
      await statementRepo.save(statementRows);

      // Dropping an approve code from a policy can strip it from a role that is the configured approver of an ACTIVE
      // workflow level. Refuse (409) and roll this edit back rather than leave a level nobody can act on.
      const keptCodes = new Set(resolvedStatements.flatMap((s) => s.actions));
      const removedApproveCodes = oldStatements
        .filter((s) => s.effect === POLICY_EFFECT.ALLOW)
        .flatMap((s) => s.actions ?? [])
        .filter((code) => !keptCodes.has(code) && WORKFLOW_APPROVE_CODES.has(code));
      if (removedApproveCodes.length > 0) {
        const attachments = await manager.getRepository(RolePolicy).find({ where: { policyId: id } });
        await this.assertApproverEligibilityKept(manager, attachments.map((a) => a.roleId), removedApproveCodes, 'This policy edit');
      }

      await this.audit.record(
        {
          moduleName: AUDIT_MODULE.POLICIES,
          entityId: id,
          action: AUDIT_ACTION.UPDATE,
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
    return this.policies.find({
      where: this.organizationWhere(),
      relations: { statements: { resource: true } },
      order: { name: SORT_ORDER.ASC },
    });
  }

  async findOnePolicy(id: number, manager = this.dataSource.manager): Promise<Policy> {
    const policy = await manager.getRepository(Policy).findOne({
      where: { id },
      relations: { statements: { resource: true } },
    });
    if (!policy || policy.organizationId !== this.context.getOrganizationId()) {
      throw new NotFoundException(ERROR_MESSAGES.POLICY_NOT_FOUND);
    }
    return policy;
  }

  /**
   * System-managed policies can never be deleted through this API — checked first, before the
   * ordinary "still attached to N role(s)" guard below, so the error always names the real reason
   * (system-managed, not "detach it first") even for a system policy that happens to be unattached.
   */
  async removePolicy(id: number, actorId?: number): Promise<{ message: string }> {
    const policy = await this.policies.findOne({ where: { id } });
    if (!policy || policy.organizationId !== this.context.getOrganizationId()) {
      throw new NotFoundException(ERROR_MESSAGES.POLICY_NOT_FOUND);
    }

    if (policy.isSystem) {
      throw new ForbiddenException('This policy is system-managed and cannot be deleted.');
    }

    const attachedCount = await this.rolePolicies.count({ where: { policyId: id } });
    if (attachedCount > 0) {
      throw new ConflictException(
        `This policy is attached to ${attachedCount} role(s) — detach it from every role before deleting`,
      );
    }

    // Soft delete is an UPDATE, so the policy's statements would otherwise stay behind as rows pointing at
    // a deleted policy; they belong to it alone, so they go in the same transaction.
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PolicyStatement).delete({ policyId: id });
      await manager.getRepository(Policy).softRemove(policy);
    });
    await this.audit.record({ moduleName: AUDIT_MODULE.POLICIES, entityId: id, action: AUDIT_ACTION.DELETE, oldValue: policy, performedBy: actorId });
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
    const role = await this.roles.findOne({ where: { id: roleId }, select: { id: true, organizationId: true } });
    if (!role || role.organizationId !== this.context.getOrganizationId()) {
      throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
    }

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

    const direction = query.sortOrder === SORT_ORDER.DESC ? SORT_ORDER.DESC : SORT_ORDER.ASC;
    const sortColumn =
      query.sortBy === 'attachedEntities' ? 'attached_entities' : query.sortBy === 'type' ? 'policy.isSystem' : 'policy.name';
    qb.orderBy(sortColumn, direction);
    // Ties fall back to the name so the order never jumps between requests.
    if (sortColumn !== 'policy.name') qb.addOrderBy('policy.name', SORT_ORDER.ASC);

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
    const contextOrganizationId = this.context.getOrganizationId();
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (!role || role.organizationId !== contextOrganizationId) {
      throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
    }
    const policy = await this.policies.findOne({ where: { id: policyId } });
    if (!policy || policy.organizationId !== contextOrganizationId) {
      throw new NotFoundException(ERROR_MESSAGES.POLICY_NOT_FOUND);
    }
    // Both already match the caller's own context above, which transitively guarantees they match
    // each other too — stated explicitly (rather than left implicit) since this is the one place a
    // Role and a Policy from two different organizations could otherwise be cross-wired together.
    if (role.organizationId !== policy.organizationId) {
      throw new ForbiddenException('A role and a policy from different organizations cannot be attached together.');
    }

    // SUPER_ADMIN is a system-administration role: a policy that lists business-approval codes can never be attached
    // to it (the resolver would ignore them anyway — refusing says so instead of pretending the grant works).
    if (role.roleName === ROLES.SUPER_ADMIN) {
      await this.assertNoBusinessApprovalForSuperAdmin(await this.getPolicyActionCodes(policyId), { roleIds: [roleId] });
    }

    const existing = await this.rolePolicies.findOne({ where: { roleId, policyId } });
    if (existing) return; // already attached — idempotent, not an error

    try {
      await this.rolePolicies.save(this.rolePolicies.create({ roleId, policyId, organizationId: role.organizationId }));
    } catch (err) {
      // An identical attach committed between the check above and this insert (a double-click, or two
      // admins at once). The unique (roleId, policyId) index is the real arbiter: the policy IS attached
      // now, which is all idempotency promises — so this is a success, not a 500, and not ours to audit.
      if (isDuplicateKeyError(err)) return;
      throw err;
    }
    await this.audit.record({
      moduleName: AUDIT_MODULE.ROLE_POLICIES,
      entityId: roleId,
      action: 'ATTACH_POLICY',
      newValue: { policyId, policyName: policy.name },
      performedBy: actorId,
    });
  }

  async detachPolicyFromRole(roleId: number, policyId: number, actorId?: number): Promise<void> {
    const role0 = await this.roles.findOne({ where: { id: roleId }, select: { id: true, organizationId: true } });
    if (!role0 || role0.organizationId !== this.context.getOrganizationId()) {
      throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
    }

    const existing = await this.rolePolicies.findOne({ where: { roleId, policyId } });
    if (!existing) return; // already detached — idempotent, not an error

    // SUPER_ADMIN must keep every active, supported permission auto-granted at all times
    // (ensureAdminPolicyGrants reconciles this on every boot — it adds missing grants and strips the
    // business-approval codes — but it never re-attaches a Policy someone manually detached in between
    // restarts, unless the role is left with none at all). Detaching ANY
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

    // Detaching must not strip a workflow approve code from a role that is the configured approver of an ACTIVE
    // workflow level (409, instead of a level nobody can act on). Only a policy that lists such a code needs the
    // check — and only then does the removal run in a transaction, so the refusal rolls it back.
    const removedApproveCodes = (await this.getPolicyActionCodes(policyId)).filter((code) => WORKFLOW_APPROVE_CODES.has(code));
    if (removedApproveCodes.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(RolePolicy).remove(existing);
        await this.assertApproverEligibilityKept(manager, [roleId], removedApproveCodes, 'Detaching this policy');
      });
    } else {
      await this.rolePolicies.remove(existing);
    }
    await this.audit.record({
      moduleName: AUDIT_MODULE.ROLE_POLICIES,
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
   *  ONE exception to "holding more roles can only ADD codes": a principal that holds the SUPER_ADMIN role never
   *  receives a business-approval code (business-approval-actions.ts). Those codes are dropped from the union
   *  whichever policy, inline policy or OTHER role of the same principal lists them — SUPER_ADMIN is a
   *  system-administration role, not a business approver, and this is the one place every authorization read
   *  passes through, so no route, service check or policy edit can get around it. Every other code of every
   *  other role still unions exactly as described above.
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

    const [roleRows, roleInlinePolicies, userInlinePolicies, holdsSuperAdmin] = await Promise.all([
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
      this.holdsSuperAdminRole(validRoleIds),
    ]);

    const codes = new Set<string>();
    for (const row of roleRows) {
      for (const statement of row.policy?.statements ?? []) {
        if (statement.effect !== POLICY_EFFECT.ALLOW) continue; // defensive — nothing ever writes a non-Allow value in this phase
        for (const code of statement.actions) codes.add(code);
      }
    }
    for (const roleInline of roleInlinePolicies) {
      for (const statement of roleInline.statements ?? []) {
        if (statement.effect !== POLICY_EFFECT.ALLOW) continue;
        for (const code of statement.actions) codes.add(code);
      }
    }
    for (const inline of userInlinePolicies) {
      for (const statement of inline.statements ?? []) {
        if (statement.effect !== POLICY_EFFECT.ALLOW) continue;
        for (const code of statement.actions) codes.add(code);
      }
    }
    // SUPER_ADMIN administers the system; it never decides a business transaction (see the doc comment above).
    if (holdsSuperAdmin) {
      for (const code of BUSINESS_APPROVAL_ACTION_CODES) codes.delete(code);
    }
    return codes;
  }

  /** True iff ANY of the given role ids is the SUPER_ADMIN role. Looked up by id and matched on the EXACT reserved
   *  name in code — the database compares names case- and accent-insensitively, so a look-alike role is never
   *  mistaken for it. One small primary-key query, never cached (role changes apply on the next request). */
  async holdsSuperAdminRole(roleIds: number[]): Promise<boolean> {
    const ids = [...new Set(roleIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return false;
    const rows = await this.roles.find({ where: { id: In(ids) }, select: { id: true, roleName: true } });
    return rows.some((role) => role.roleName === ROLES.SUPER_ADMIN);
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

  /** The Policy-model counterpart to RolePermissionsService.ensureAdminGrants — keeps the attached Policy of SUPER_ADMIN,
   *  the ONLY predefined role, in sync with every active, Resource-mapped Action code it may hold. Necessary because real
   *  authorization now resolves exclusively through Policies (roleHasActionViaPolicy) — without this, an Action added to
   *  seed-data.ts after the one-time IAM backfill migration is auto-"granted" in the legacy tree by ensureAdminGrants but
   *  never reaches SUPER_ADMIN's real, enforced Policy, silently leaving it unable to use its own endpoints.
   *
   *  No other role is ever touched. Every other role is created and managed dynamically by SUPER_ADMIN and lives only in
   *  the database, so this neither looks one up, assumes one exists, creates one, nor hands one an automatic grant: a role
   *  that happens to be called ADMIN (or FINANCE, ...) is an ordinary role whose access is exactly the Policies an
   *  administrator attached to it.
   *
   *  SUPER_ADMIN is the application's root/owner account and gets every active action EXCEPT the business-approval codes
   *  (business-approval-actions.ts): it administers the system, it does not decide business transactions. Those codes are
   *  never granted to it AND are stripped from its system policy on every boot, so a restart, a reseed or a later
   *  migration can never restore them. It still gets e.g. WORKFLOW_MANAGE_APPROVERS (system configuration). This is
   *  scoped to the Policy model only (RolePermissionsService.ensureAdminGrants applies the same SUPER_ADMIN rule to the
   *  legacy tree), since only Policies decide real authorization.
   *
   *  Creates SUPER_ADMIN's own Policy (named "SUPER_ADMIN Policy", matching AddIamPolicyBackfill's own naming convention)
   *  and attaches it if one doesn't exist yet — the case on a genuinely fresh install: that migration only backfills a
   *  Policy for a role that already had legacy role_permissions rows at the time it ran, and on a brand-new database
   *  migrations run (via `migrationsRun: true`) BEFORE bootstrap's seed() has created any Role/RolePermission rows at all
   *  — so without this, SUPER_ADMIN would boot with zero Policy grants on a fresh install, and the frontend's
   *  Policy-based sidebar/action gating would show nothing for it.
   *
   *  On every boot the SUPER_ADMIN policy is synced: it is system-managed and cannot be edited, so nothing can have been
   *  revoked from it, and it must always cover every active action it may hold (adds a missing action to a resource's
   *  existing statement, or a new statement for a resource not yet covered, and strips the business approvals).
   *  Idempotent and safe to run on every boot, same as ensureResourceCatalog. */
  async ensureAdminPolicyGrants(): Promise<void> {
    // The database compares role names case- and accent-insensitively, so it also returns a look-alike such as
    // "SÜPER_ADMIN" for 'SUPER_ADMIN'. Only the EXACT reserved name is the system role: a look-alike must never be handed
    // the auto-granted admin access.
    const role = (await this.roles.find({ where: { roleName: ROLES.SUPER_ADMIN } })).find(
      (candidate) => candidate.roleName === ROLES.SUPER_ADMIN,
    );
    if (!role) return;

    const [activeActions, allResources] = await Promise.all([
      this.actions.find({ where: { isActive: true } }),
      this.resources.find(),
    ]);
    const activeCodeSet = new Set(activeActions.map((a) => a.code));
    const resourceRowByCode = new Map(allResources.map((r) => [r.code, r]));

    // resourceCode -> every currently-active action code SUPER_ADMIN may hold: the active codes of the catalogue minus the
    // business approvals it never holds.
    const grantableByResourceCode = new Map<string, Set<string>>();
    for (const resource of RESOURCES) {
      const grantable = resource.actionCodes.filter(
        (code) => activeCodeSet.has(code) && !BUSINESS_APPROVAL_ACTION_CODES.has(code),
      );
      if (grantable.length > 0) grantableByResourceCode.set(resource.code, new Set(grantable));
    }

    let rolePolicyRows = await this.rolePolicies.find({
      where: { roleId: role.id },
      relations: { policy: { statements: true } },
    });

    if (rolePolicyRows.length === 0) {
      // isSystem is set here (and by the backfill safety nets below) and NOWHERE else — never via
      // CreatePolicyDto/UpdatePolicyDto.
      const policyName = `${role.roleName} Policy`;
      // Defensive: reuse a Policy already named this (e.g. a prior partial run, or one the backfill migration created for
      // this role before) rather than failing on the unique-name constraint.
      let policy = await this.policies.findOne({ where: { name: policyName } });
      if (!policy) {
        policy = await this.policies.save(
          this.policies.create({
            name: policyName,
            description: SUPER_ADMIN_POLICY_DESCRIPTION,
            isSystem: true,
          }),
        );
      } else if (!policy.isSystem) {
        // Backfill safety net for an environment that somehow still has an unflagged SUPER_ADMIN
        // Policy row at this point (the migration already backfills by name — this covers the
        // fresh-install race where ensureAdminPolicyGrants's own "reuse a Policy already named
        // this" branch runs before any migration-driven backfill could apply).
        policy.isSystem = true;
        policy = await this.policies.save(policy);
      }
      // SUPER_ADMIN's own role/policy pairing is platform-level (organization_id NULL on both sides),
      // same as `role.organizationId` resolved earlier in this method.
      await this.rolePolicies.save(this.rolePolicies.create({ roleId: role.id, policyId: policy.id, organizationId: role.organizationId ?? null }));
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
    if (!primaryPolicy.isSystem) {
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
        if (statement.effect !== POLICY_EFFECT.ALLOW) continue;
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
          effect: POLICY_EFFECT.ALLOW,
          actions: missing,
        });
        await this.statements.save(created);
        changed = true;
      }
    }

    // SUPER_ADMIN never holds business-approval codes (business-approval-actions.ts). The grant loop above only ever
    // ADDS, so also REMOVE any that an earlier version of this sync, a migration or a manual edit left in its system
    // policy — on every boot, so no restart, reseed or later migration can bring them back.
    const stripped = await this.stripBusinessApprovalCodes(primaryPolicy);
    if (stripped.length > 0) {
      this.logger.warn(`ensureAdminPolicyGrants: removed business-approval code(s) from "${primaryPolicy.name}": ${stripped.join(', ')}`);
      changed = true;
    }

    // The stored description predates the rule; keep the system policy's own text truthful (the policy cannot be
    // edited through the API, so nobody else would). `update`, not `save`: saving the policy would cascade into
    // its statements.
    if (typeof primaryPolicy.description === 'string' && primaryPolicy.description !== SUPER_ADMIN_POLICY_DESCRIPTION) {
      primaryPolicy.description = SUPER_ADMIN_POLICY_DESCRIPTION;
      await this.policies.update({ id: primaryPolicy.id }, { description: SUPER_ADMIN_POLICY_DESCRIPTION });
    }

    // Another policy attached to SUPER_ADMIN may still list such a code. It is not edited here (only the system
    // policy is ours) and the resolver ignores it — but say so, so an administrator can detach or edit that policy.
    const listedElsewhere = new Set(
      rolePolicyRows
        .filter((row) => row.policy && row.policy.id !== primaryPolicy.id)
        .flatMap((row) => (row.policy!.statements ?? []).flatMap((s) => s.actions ?? []))
        .filter((code) => BUSINESS_APPROVAL_ACTION_CODES.has(code)),
    );
    if (listedElsewhere.size > 0) {
      this.logger.warn(
        `ensureAdminPolicyGrants: another policy attached to SUPER_ADMIN lists business-approval code(s) ` +
          `${[...listedElsewhere].join(', ')} — they are ignored (SUPER_ADMIN never holds them); detach or edit that policy.`,
      );
    }

    if (!changed) return;

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
    // Re-read the system policy's own rows (not the resolver, which masks these codes for SUPER_ADMIN anyway):
    // the rule is only really kept if the rows are clean.
    const leftovers = (await this.statements.find({ where: { policyId: primaryPolicy.id } }))
      .flatMap((s) => s.actions ?? [])
      .filter((code) => BUSINESS_APPROVAL_ACTION_CODES.has(code));
    if (leftovers.length > 0) {
      throw new Error(
        `ensureAdminPolicyGrants self-check failed for role "${role.roleName}": business-approval code(s) still in its system policy: ${[...new Set(leftovers)].join(', ')}`,
      );
    }
    this.logger.log(`ensureAdminPolicyGrants: synced "${role.roleName}"'s Policy with the active Resource/Action catalog`);
  }

  /** Removes every business-approval code from a policy's statements (a statement left with no action is deleted)
   *  and returns the codes it removed. Only ever used on the system-managed SUPER_ADMIN policy. */
  private async stripBusinessApprovalCodes(policy: Policy): Promise<string[]> {
    const stripped = new Set<string>();
    for (const statement of [...(policy.statements ?? [])]) {
      const actions = statement.actions ?? [];
      const kept = actions.filter((code) => !BUSINESS_APPROVAL_ACTION_CODES.has(code));
      if (kept.length === actions.length) continue;
      actions.filter((code) => BUSINESS_APPROVAL_ACTION_CODES.has(code)).forEach((code) => stripped.add(code));
      if (kept.length === 0) {
        // delete(id) — never delete({ id }): an undefined id would become "no condition" and match every row.
        await this.statements.delete(statement.id);
        policy.statements = (policy.statements ?? []).filter((s) => s !== statement);
      } else {
        statement.actions = kept;
        await this.statements.save(statement);
      }
    }
    return [...stripped];
  }

  // ── Business approvals and workflow approvers ─────────────────────────────────────────────────

  /** Every Allow action code a managed policy's statements list. */
  private async getPolicyActionCodes(policyId: number): Promise<string[]> {
    const rows = await this.statements.find({ where: { policyId } });
    return rows.filter((s) => s.effect === POLICY_EFFECT.ALLOW).flatMap((s) => s.actions ?? []);
  }

  /** Rejects (400) a write that would give a business-approval code to SUPER_ADMIN. `owner.roleIds` are the roles the
   *  grant would land on (a role's own inline policy, the roles a policy is attached to); `owner.userId` is the user
   *  whose OWN inline policy it is. The resolver would ignore such a grant anyway — refusing it up front means nobody
   *  is told a grant took effect that never can. */
  async assertNoBusinessApprovalForSuperAdmin(
    codes: Iterable<string>,
    owner: { roleIds?: number[]; userId?: number },
  ): Promise<void> {
    const restricted = [...new Set([...codes].filter((code) => BUSINESS_APPROVAL_ACTION_CODES.has(code)))];
    if (restricted.length === 0) return;

    let isSuperAdmin = owner.roleIds ? await this.holdsSuperAdminRole(owner.roleIds) : false;
    if (!isSuperAdmin && owner.userId !== undefined) {
      const rows: { role_name: string }[] = await this.dataSource.query(
        `SELECT r.role_name AS role_name
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ? AND r.deleted_at IS NULL`,
        [owner.userId],
      );
      isSuperAdmin = rows.some((row) => row.role_name === ROLES.SUPER_ADMIN);
    }
    if (isSuperAdmin) {
      throw new BadRequestException(
        `SUPER_ADMIN is a system-administration role and cannot be granted business approval permissions ` +
          `(${restricted.join(', ')}). Business approvals belong to the designated business roles.`,
      );
    }
  }

  /** Ids of every role that may be configured as an approver of a workflow whose approve code(s) are `actionCodes`: a
   *  role qualifies while the Allow statements of its attached Policies and of its OWN inline policies list at least
   *  one of them — the same sources and the same Allow-only rule as the authorization resolver — and it is not
   *  SUPER_ADMIN, which is never an approver. Three queries for the whole role set, not one per role. This is the ONE
   *  eligibility predicate: the Approver Role dropdown and the save-time check both use it, so what the screen offers
   *  is exactly what the backend accepts. */
  async getRoleIdsHoldingAnyAction(actionCodes: string[]): Promise<number[]> {
    const wanted = new Set(actionCodes);
    if (wanted.size === 0) return [];

    const [attached, inline, liveRoles] = await Promise.all([
      this.rolePolicies.find({ relations: { policy: { statements: true } } }),
      this.roleInlinePolicies.find({ relations: { statements: true } }),
      this.roles.find({ select: { id: true, roleName: true } }),
    ]);
    const liveRoleIds = new Set(liveRoles.map((role) => role.id));
    const superAdminIds = new Set(liveRoles.filter((role) => role.roleName === ROLES.SUPER_ADMIN).map((role) => role.id));

    const eligible = new Set<number>();
    const consider = (roleId: number, statements: { effect: string; actions: string[] }[] = []) => {
      if (eligible.has(roleId) || !liveRoleIds.has(roleId) || superAdminIds.has(roleId)) return;
      if (statements.some((s) => s.effect === POLICY_EFFECT.ALLOW && (s.actions ?? []).some((code) => wanted.has(code)))) eligible.add(roleId);
    };
    for (const row of attached) consider(row.roleId, row.policy?.statements);
    for (const row of inline) consider(row.roleId, row.statements);
    return [...eligible];
  }

  /** Called INSIDE the transaction of a change that took `removedCodes` away from `roleIds` (a policy detached from a
   *  role, a policy or inline policy edited or deleted). Throws 409 — rolling the change back — if a role that is the
   *  configured approver of a level of an ACTIVE workflow definition no longer holds that workflow's approve code,
   *  naming the role, workflow and level. Only workflows whose approve code is among `removedCodes` are examined, so
   *  a change that touches none of them costs nothing, and an approver that was ALREADY ineligible before the change
   *  never blocks an unrelated edit. SUPER_ADMIN levels are skipped: it is never eligible, which is reported where the
   *  workflow is published. Raw SQL on the workflow tables (as RoleService.remove does) because this module must not
   *  import the workflow module. */
  async assertApproverEligibilityKept(
    manager: EntityManager,
    roleIds: number[],
    removedCodes: Iterable<string>,
    subject: string,
  ): Promise<void> {
    const removed = new Set(removedCodes);
    const approveCodesByType = APPROVE_ACTION_CODES as Record<string, string[]>;
    const watchedTypes = Object.keys(approveCodesByType).filter((type) => approveCodesByType[type].some((code) => removed.has(code)));
    const ids = [...new Set(roleIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (watchedTypes.length === 0 || ids.length === 0) return;

    const levels: { role_id: number; role_name: string; workflow_type: string; level_order: number }[] = await manager.query(
      `SELECT l.roleId AS role_id, r.role_name AS role_name, d.workflowType AS workflow_type, l.levelOrder AS level_order
         FROM workflow_definition_levels l
         JOIN workflow_definitions d ON d.id = l.definitionId
         JOIN roles r ON r.id = l.roleId
        WHERE d.status = 'ACTIVE' AND d.deleted_at IS NULL AND l.deleted_at IS NULL
          AND l.roleId IN (${ids.map(() => '?').join(',')})
          AND d.workflowType IN (${watchedTypes.map(() => '?').join(',')})
        ORDER BY d.workflowType, l.levelOrder`,
      [...ids, ...watchedTypes],
    );
    const candidates = levels.filter((level) => level.role_name !== ROLES.SUPER_ADMIN);
    if (candidates.length === 0) return;

    const heldByRole = new Map<number, Set<string>>();
    for (const roleId of new Set(candidates.map((level) => level.role_id))) {
      heldByRole.set(roleId, await this.getRoleOwnedActionCodes(manager, roleId));
    }
    const orphaned = candidates.filter((level) => {
      const held = heldByRole.get(level.role_id)!;
      const required = approveCodesByType[level.workflow_type] ?? [];
      return required.some((code) => removed.has(code)) && !required.some((code) => held.has(code));
    });
    if (orphaned.length === 0) return;

    const where = orphaned
      .map((level) => `role "${level.role_name}" at Level ${level.level_order + 1} of the ${level.workflow_type} workflow`)
      .join('; ');
    throw new ConflictException(
      `${subject} would remove the approve permission from ${where}. Change that workflow's approver first, or keep the permission.`,
    );
  }

  /** The codes a ROLE itself grants — its attached Policies plus its own inline policies — read through `manager`, so a
   *  caller inside a transaction sees its own uncommitted change. */
  private async getRoleOwnedActionCodes(manager: EntityManager, roleId: number): Promise<Set<string>> {
    const [attached, inline] = await Promise.all([
      manager.getRepository(RolePolicy).find({ where: { roleId }, relations: { policy: { statements: true } } }),
      manager.getRepository(RoleInlinePolicy).find({ where: { roleId }, relations: { statements: true } }),
    ]);
    const codes = new Set<string>();
    const collect = (statements: { effect: string; actions: string[] }[] = []) => {
      for (const statement of statements) {
        if (statement.effect !== POLICY_EFFECT.ALLOW) continue;
        for (const code of statement.actions ?? []) codes.add(code);
      }
    };
    for (const row of attached) collect(row.policy?.statements);
    for (const row of inline) collect(row.statements);
    return codes;
  }
}

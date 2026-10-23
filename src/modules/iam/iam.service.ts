import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Resource } from './entities/resource.entity';
import { Policy } from './entities/policy.entity';
import { PolicyStatement } from './entities/policy-statement.entity';
import { RolePolicy } from './entities/role-policy.entity';
import { Role } from '../role/entities/role.entity';
import { Action } from '../actions/entities/action.entity';
import { RESOURCES } from './resource-catalog';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';
import { AuditService } from '../../audit/audit.service';

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
        const needsUpdate = existing.name !== seed.name || existing.displayOrder !== seed.displayOrder;
        if (needsUpdate) {
          existing.name = seed.name;
          existing.displayOrder = seed.displayOrder;
          existing = await this.resources.save(existing);
          this.logger.debug(`Corrected resource "${seed.code}" (name/displayOrder)`);
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
    (Resource & { availableActions: { code: string; name: string }[] })[]
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
        .map((a) => ({ code: a.code, name: a.name }));
      return Object.assign(resource, { availableActions });
    });
  }

  // ── Policy validation ──────────────────────────────────────────────────────────────────────────

  /** Validates every statement's resourceCode against the real Resource catalog and every
   *  actionCode against the real Action catalog AND confirms the action actually belongs to that
   *  resource (per resource-catalog.ts's own mapping) — rejects any invalid or incompatible
   *  combination rather than silently accepting a typo or a cross-resource mismatch. Returns the
   *  resolved {resourceId, actionCodes} pairs ready to persist. */
  private async validateStatements(
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

  async updatePolicy(id: number, dto: UpdatePolicyDto, actorId?: number): Promise<Policy> {
    const policy = await this.policies.findOne({ where: { id } });
    if (!policy) throw new NotFoundException('Policy not found');

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

  async removePolicy(id: number, actorId?: number): Promise<{ message: string }> {
    const policy = await this.policies.findOne({ where: { id } });
    if (!policy) throw new NotFoundException('Policy not found');

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

  async getPoliciesForRole(roleId: number): Promise<Policy[]> {
    const rows = await this.rolePolicies.find({ where: { roleId }, relations: { policy: { statements: { resource: true } } } });
    return rows.map((r) => r.policy!).filter(Boolean);
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

    await this.rolePolicies.remove(existing);
    await this.audit.record({
      moduleName: 'role_policies',
      entityId: roleId,
      action: 'DETACH_POLICY',
      oldValue: { policyId },
      performedBy: actorId,
    });
  }

  // ── Authorization resolution — the method PermissionGuard's new Policy-aware path calls ─────────

  /** Resolves every Action code a role holds via its attached Policies' statements — Allow-only, OR
   *  across every statement in every attached Policy (no Deny, no precedence to worry about). This
   *  is the ONLY method the dual-path guard needs from this service; it returns a plain Set for O(1)
   *  lookup, never re-queries per action code within one request. */
  async getActionCodesGrantedByPolicies(roleId: number): Promise<Set<string>> {
    const rows = await this.rolePolicies.find({ where: { roleId }, relations: { policy: { statements: true } } });
    const codes = new Set<string>();
    for (const row of rows) {
      for (const statement of row.policy?.statements ?? []) {
        if (statement.effect !== 'Allow') continue; // defensive — nothing ever writes a non-Allow value in this phase
        for (const code of statement.actions) codes.add(code);
      }
    }
    return codes;
  }

  async roleHasActionViaPolicy(roleId: number, actionCode: string): Promise<boolean> {
    const codes = await this.getActionCodesGrantedByPolicies(roleId);
    return codes.has(actionCode);
  }
}

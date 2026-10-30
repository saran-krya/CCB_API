import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { Role } from '../role/entities/role.entity';
import { UserRole } from '../user-role/entities/user-role.entity';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';
import { RoleInlinePolicy } from './entities/role-inline-policy.entity';
import { RoleInlinePolicyStatement } from './entities/role-inline-policy-statement.entity';
import { IamService } from './iam.service';

const WITH_STATEMENTS = { statements: { resource: true } } as const;
// Statements come back in the order they were saved, so an edit screen always lists them the same way.
const STATEMENTS_IN_SAVED_ORDER = { id: 'ASC', statements: { id: 'ASC' } } as const;
const DUPLICATE_NAME_MESSAGE = 'This role already has an inline policy with this name';

const toAuditStatements = (statements: RoleInlinePolicyStatement[] = []) =>
  statements.map((s) => ({ resourceCode: s.resource?.code, actionCodes: s.actions }));

/**
 * Inline (role-attached) policies — the Role-level mirror of UserInlinePolicyService, one level up:
 * grants that belong to exactly one Role, on top of whatever that Role's attached (shared) Policies
 * already grant. Because every user who holds the role inherits whatever the role grants, a role's
 * inline policy's grants reach every one of that role's current holders too. The grants are ENFORCED,
 * not just stored — IamService resolves them into the same live union every authorization check reads
 * (see getActionCodesGrantedByPoliciesForRoles), so creating one grants access to every holder of the
 * role on their very next request, and deleting one revokes it the same way.
 *
 * Guardrails (server-side; the UI hiding a button is never the control):
 *  - The controller is @Roles(SUPER_ADMIN): the same boundary as Policy Management and
 *    UserInlinePolicyController, since a role's inline policy IS "what everyone holding that role can
 *    do" and is exactly as escalation-sensitive as editing a shared Policy.
 *  - Nobody may change the inline policies of a role THEY THEMSELVES currently hold — the Role-level
 *    equivalent of "not your own account": an admin could otherwise grant themselves (and everyone
 *    else sharing the role) more access with nobody else approving. Checked against user_roles live,
 *    never a role claim from the JWT.
 *  - Statements are validated against the real Resource/Action catalog by the same code shared
 *    Policies and user inline policies use (IamService.validateStatements) — never trusted from the
 *    client.
 *  - A role's inline policies can never be attached to another Role or listed as a shared Policy: they
 *    live in their own tables.
 */
@Injectable()
export class RoleInlinePolicyService {
  constructor(
    @InjectRepository(RoleInlinePolicy) private readonly inlinePolicies: Repository<RoleInlinePolicy>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    private readonly iam: IamService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async findAllForRole(roleId: number): Promise<RoleInlinePolicy[]> {
    await this.assertRoleExists(roleId);
    return this.inlinePolicies.find({ where: { roleId }, relations: WITH_STATEMENTS, order: STATEMENTS_IN_SAVED_ORDER });
  }

  /** One inline policy of this role — scoped by roleId, so another role's policy id is a 404, never a leak. */
  async findOne(roleId: number, policyId: number): Promise<RoleInlinePolicy> {
    await this.assertRoleExists(roleId);
    const policy = await this.inlinePolicies.findOne({
      where: { id: policyId, roleId },
      relations: WITH_STATEMENTS,
      order: STATEMENTS_IN_SAVED_ORDER,
    });
    if (!policy) throw new NotFoundException('Inline policy not found');
    return policy;
  }

  async create(roleId: number, dto: CreatePolicyDto, actorId?: number): Promise<RoleInlinePolicy> {
    await this.assertRoleExists(roleId);
    await this.assertNotOwnRole(roleId, actorId);

    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Policy name is required');

    const duplicate = await this.inlinePolicies.findOne({ where: { roleId, name } });
    if (duplicate) throw new ConflictException(DUPLICATE_NAME_MESSAGE);

    const resolved = await this.iam.validateStatements(dto.statements);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const policyRepo = manager.getRepository(RoleInlinePolicy);
        const statementRepo = manager.getRepository(RoleInlinePolicyStatement);

        const policy = await policyRepo.save(policyRepo.create({ roleId, name, description: dto.description }));
        await statementRepo.save(
          resolved.map((s) =>
            statementRepo.create({ policyId: policy.id, resourceId: s.resourceId, effect: 'Allow', actions: s.actions }),
          ),
        );

        await this.audit.record(
          {
            moduleName: 'role_inline_policies',
            entityId: roleId,
            action: 'CREATE_ROLE_INLINE_POLICY',
            newValue: { policyId: policy.id, name, statements: dto.statements },
            performedBy: actorId,
          },
          manager,
        );

        return policyRepo.findOneOrFail({ where: { id: policy.id }, relations: WITH_STATEMENTS });
      });
    } catch (error) {
      // Two concurrent creates with the same name both pass the pre-check above; the unique
      // (roleId, name) key is the real arbiter.
      this.rethrowDuplicateName(error);
      throw error;
    }
  }

  /**
   * Edits one inline policy in place (name, description and the FULL statement list — the same payload
   * as create, a replacement, not a merge). Takes effect on every holder of the role's very next
   * request: the new statements are committed in one transaction and authorization re-reads them every
   * time, so it sees either the old statements or the new ones, never a half-replaced policy.
   */
  async update(roleId: number, policyId: number, dto: UpdatePolicyDto, actorId?: number): Promise<RoleInlinePolicy> {
    await this.assertRoleExists(roleId);
    await this.assertNotOwnRole(roleId, actorId);

    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Policy name is required');

    const existing = await this.inlinePolicies.findOne({ where: { id: policyId, roleId }, relations: WITH_STATEMENTS });
    if (!existing) throw new NotFoundException('Inline policy not found');

    if (name !== existing.name) {
      const duplicate = await this.inlinePolicies.findOne({ where: { roleId, name } });
      // The (roleId, name) unique key is case/accent-insensitive in MySQL, so renaming a policy to a
      // different spelling of its OWN name (e.g. "Tariff view" -> "tariff view") finds the policy
      // itself — only ANOTHER policy with that name is a conflict.
      if (duplicate && duplicate.id !== policyId) throw new ConflictException(DUPLICATE_NAME_MESSAGE);
    }

    const resolved = await this.iam.validateStatements(dto.statements);
    const description = dto.description?.trim() || null;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const policyRepo = manager.getRepository(RoleInlinePolicy);
        const statementRepo = manager.getRepository(RoleInlinePolicyStatement);

        // Serialize concurrent edits of this policy, and re-check it still exists: a delete may have
        // won the race since the read above.
        const locked = await policyRepo.findOne({ where: { id: policyId, roleId }, lock: { mode: 'pessimistic_write' } });
        if (!locked) throw new NotFoundException('Inline policy not found');

        // update() (not save()) so updated_at moves even when only the statements changed.
        await policyRepo.update({ id: policyId }, { name, description });
        await statementRepo.delete({ policyId });
        await statementRepo.save(
          resolved.map((s) =>
            statementRepo.create({ policyId, resourceId: s.resourceId, effect: 'Allow', actions: s.actions }),
          ),
        );

        await this.audit.record(
          {
            moduleName: 'role_inline_policies',
            entityId: roleId,
            action: 'UPDATE_ROLE_INLINE_POLICY',
            oldValue: {
              policyId,
              name: existing.name,
              description: existing.description ?? null,
              statements: toAuditStatements(existing.statements),
            },
            newValue: { policyId, name, description, statements: dto.statements },
            performedBy: actorId,
          },
          manager,
        );

        return policyRepo.findOneOrFail({ where: { id: policyId }, relations: WITH_STATEMENTS, order: STATEMENTS_IN_SAVED_ORDER });
      });
    } catch (error) {
      // A concurrent rename/create to the same name passes the pre-check; the unique key arbitrates.
      this.rethrowDuplicateName(error);
      throw error;
    }
  }

  /** HARD delete — the unique (roleId, name) key must never stay held by a soft-deleted row. Takes
   *  effect on every holder of the role's very next request: authorization re-reads a role's inline
   *  policies every time. */
  async remove(roleId: number, policyId: number, actorId?: number): Promise<{ message: string }> {
    await this.assertNotOwnRole(roleId, actorId);

    await this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(RoleInlinePolicy);
      const policy = await policyRepo.findOne({ where: { id: policyId, roleId }, relations: WITH_STATEMENTS });
      if (!policy) throw new NotFoundException('Inline policy not found');

      await manager.getRepository(RoleInlinePolicyStatement).delete({ policyId });
      await policyRepo.delete({ id: policyId });

      await this.audit.record(
        {
          moduleName: 'role_inline_policies',
          entityId: roleId,
          action: 'DELETE_ROLE_INLINE_POLICY',
          oldValue: { policyId, name: policy.name, statements: toAuditStatements(policy.statements) },
          performedBy: actorId,
        },
        manager,
      );
    });

    return { message: 'Inline policy deleted' };
  }

  private rethrowDuplicateName(error: unknown): void {
    const code = (error as { code?: string })?.code ?? (error as { driverError?: { code?: string } })?.driverError?.code;
    if (code === 'ER_DUP_ENTRY') throw new ConflictException(DUPLICATE_NAME_MESSAGE);
  }

  /** The Role-level equivalent of "not your own account": refuses the write if the acting user
   *  currently holds this exact role (live against user_roles, never a role claim from the JWT) — an
   *  admin editing a role they themselves hold could otherwise grant themselves (and everyone else
   *  sharing the role) more access with nobody else approving. */
  private async assertNotOwnRole(roleId: number, actorId?: number): Promise<void> {
    if (actorId === undefined) return;
    const holds = await this.userRoles.findOne({ where: { userId: actorId, roleId } });
    if (holds) {
      throw new ForbiddenException('You cannot change the inline policies of a role you currently hold.');
    }
  }

  private async assertRoleExists(roleId: number): Promise<void> {
    const role = await this.roles.findOne({ where: { id: roleId }, select: { id: true } });
    if (!role) throw new NotFoundException('Role not found');
  }
}

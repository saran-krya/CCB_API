import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { User } from '../user/entities/user.entity';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';
import { UserInlinePolicy } from './entities/user-inline-policy.entity';
import { UserInlinePolicyStatement } from './entities/user-inline-policy-statement.entity';
import { IamService } from './iam.service';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { AUDIT_MODULE } from '../../audit/audit.constants';
import { LOCK_MODE, MYSQL_ERROR_CODE } from '../../common/constants/database.constants';
import { WITH_STATEMENTS, STATEMENTS_IN_SAVED_ORDER, POLICY_EFFECT } from './iam.constants';

const DUPLICATE_NAME_MESSAGE = 'This user already has an inline policy with this name';

const toAuditStatements = (statements: UserInlinePolicyStatement[] = []) =>
  statements.map((s) => ({ resourceCode: s.resource?.code, actionCodes: s.actions }));

/**
 * Inline (user-attached) policies: grants that belong to exactly one user, on top of whatever their
 * roles already grant. The grants are ENFORCED, not just stored — IamService resolves them into the
 * same live union every authorization check reads (see getActionCodesGrantedByPoliciesForRoles), so
 * creating one grants access on the user's next request and deleting one revokes it on the next.
 *
 * Guardrails (server-side; the UI hiding a button is never the control):
 *  - The controller is @Roles(SUPER_ADMIN): the same boundary as Policy Management, since an inline
 *    policy IS "what a user can do" and is exactly as escalation-sensitive as editing a shared Policy.
 *  - Nobody may change their OWN inline policies (same reasoning as the own-roles rule: no
 *    self-granting with nobody else approving).
 *  - Statements are validated against the real Resource/Action catalog by the same code shared
 *    Policies use (IamService.validateStatements) — never trusted from the client.
 *  - Inline policies can never be attached to a Role or listed as a shared Policy: they live in their
 *    own tables.
 */
@Injectable()
export class UserInlinePolicyService {
  constructor(
    @InjectRepository(UserInlinePolicy) private readonly inlinePolicies: Repository<UserInlinePolicy>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly iam: IamService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async findAllForUser(userId: number): Promise<UserInlinePolicy[]> {
    await this.assertUserExists(userId);
    return this.inlinePolicies.find({ where: { userId }, relations: WITH_STATEMENTS, order: STATEMENTS_IN_SAVED_ORDER });
  }

  /** One inline policy of this user — scoped by userId, so another user's policy id is a 404, never a leak. */
  async findOne(userId: number, policyId: number): Promise<UserInlinePolicy> {
    await this.assertUserExists(userId);
    const policy = await this.inlinePolicies.findOne({
      where: { id: policyId, userId },
      relations: WITH_STATEMENTS,
      order: STATEMENTS_IN_SAVED_ORDER,
    });
    if (!policy) throw new NotFoundException(ERROR_MESSAGES.INLINE_POLICY_NOT_FOUND);
    return policy;
  }

  async create(userId: number, dto: CreatePolicyDto, actorId?: number): Promise<UserInlinePolicy> {
    this.assertNotOwnAccount(userId, actorId);
    await this.assertUserExists(userId);

    const name = dto.name.trim();
    if (!name) throw new BadRequestException(ERROR_MESSAGES.POLICY_NAME_REQUIRED);

    const duplicate = await this.inlinePolicies.findOne({ where: { userId, name } });
    if (duplicate) throw new ConflictException(DUPLICATE_NAME_MESSAGE);

    const resolved = await this.iam.validateStatements(dto.statements);
    await this.iam.assertNoBusinessApprovalForSuperAdmin(resolved.flatMap((s) => s.actions), { userId });

    try {
      return await this.dataSource.transaction(async (manager) => {
        const policyRepo = manager.getRepository(UserInlinePolicy);
        const statementRepo = manager.getRepository(UserInlinePolicyStatement);

        const policy = await policyRepo.save(policyRepo.create({ userId, name, description: dto.description }));
        await statementRepo.save(
          resolved.map((s) =>
            statementRepo.create({ policyId: policy.id, resourceId: s.resourceId, effect: POLICY_EFFECT.ALLOW, actions: s.actions }),
          ),
        );

        await this.audit.record(
          {
            moduleName: AUDIT_MODULE.USER_INLINE_POLICIES,
            entityId: userId,
            action: 'CREATE_INLINE_POLICY',
            newValue: { policyId: policy.id, name, statements: dto.statements },
            performedBy: actorId,
          },
          manager,
        );

        return policyRepo.findOneOrFail({ where: { id: policy.id }, relations: WITH_STATEMENTS });
      });
    } catch (error) {
      // Two concurrent creates with the same name both pass the pre-check above; the unique
      // (userId, name) key is the real arbiter.
      this.rethrowDuplicateName(error);
      throw error;
    }
  }

  /**
   * Edits one inline policy in place (name, description and the FULL statement list — the same payload
   * as create, a replacement, not a merge). Takes effect on the user's very next request: the new
   * statements are committed in one transaction and authorization re-reads them every time, so it sees
   * either the old statements or the new ones, never a half-replaced policy.
   */
  async update(userId: number, policyId: number, dto: UpdatePolicyDto, actorId?: number): Promise<UserInlinePolicy> {
    this.assertNotOwnAccount(userId, actorId);
    await this.assertUserExists(userId);

    const name = dto.name.trim();
    if (!name) throw new BadRequestException(ERROR_MESSAGES.POLICY_NAME_REQUIRED);

    const existing = await this.inlinePolicies.findOne({ where: { id: policyId, userId }, relations: WITH_STATEMENTS });
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.INLINE_POLICY_NOT_FOUND);

    if (name !== existing.name) {
      const duplicate = await this.inlinePolicies.findOne({ where: { userId, name } });
      // The (userId, name) unique key is case/accent-insensitive in MySQL, so renaming a policy to a different
      // spelling of its OWN name (e.g. "Tariff view" -> "tariff view") finds the policy itself — only ANOTHER
      // policy with that name is a conflict.
      if (duplicate && duplicate.id !== policyId) throw new ConflictException(DUPLICATE_NAME_MESSAGE);
    }

    const resolved = await this.iam.validateStatements(dto.statements);
    await this.iam.assertNoBusinessApprovalForSuperAdmin(resolved.flatMap((s) => s.actions), { userId });
    const description = dto.description?.trim() || null;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const policyRepo = manager.getRepository(UserInlinePolicy);
        const statementRepo = manager.getRepository(UserInlinePolicyStatement);

        // Serialize concurrent edits of this policy, and re-check it still exists: a delete may have won
        // the race since the read above.
        const locked = await policyRepo.findOne({ where: { id: policyId, userId }, lock: { mode: LOCK_MODE.PESSIMISTIC_WRITE } });
        if (!locked) throw new NotFoundException(ERROR_MESSAGES.INLINE_POLICY_NOT_FOUND);

        // update() (not save()) so updated_at moves even when only the statements changed.
        await policyRepo.update({ id: policyId }, { name, description });
        await statementRepo.delete({ policyId });
        await statementRepo.save(
          resolved.map((s) =>
            statementRepo.create({ policyId, resourceId: s.resourceId, effect: POLICY_EFFECT.ALLOW, actions: s.actions }),
          ),
        );

        await this.audit.record(
          {
            moduleName: AUDIT_MODULE.USER_INLINE_POLICIES,
            entityId: userId,
            action: 'UPDATE_INLINE_POLICY',
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

  /** HARD delete — the unique (userId, name) key must never stay held by a soft-deleted row. Takes
   *  effect on the user's very next request: authorization re-reads their inline policies every time. */
  async remove(userId: number, policyId: number, actorId?: number): Promise<{ message: string }> {
    this.assertNotOwnAccount(userId, actorId);

    await this.dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(UserInlinePolicy);
      const policy = await policyRepo.findOne({ where: { id: policyId, userId }, relations: WITH_STATEMENTS });
      if (!policy) throw new NotFoundException(ERROR_MESSAGES.INLINE_POLICY_NOT_FOUND);

      await manager.getRepository(UserInlinePolicyStatement).delete({ policyId });
      await policyRepo.delete({ id: policyId });

      await this.audit.record(
        {
          moduleName: AUDIT_MODULE.USER_INLINE_POLICIES,
          entityId: userId,
          action: 'DELETE_INLINE_POLICY',
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
    if (code === MYSQL_ERROR_CODE.DUP_ENTRY) throw new ConflictException(DUPLICATE_NAME_MESSAGE);
  }

  private assertNotOwnAccount(userId: number, actorId?: number): void {
    if (actorId !== undefined && actorId === userId) {
      throw new ForbiddenException('You cannot change your own permissions.');
    }
  }

  private async assertUserExists(userId: number): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
  }
}

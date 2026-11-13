import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { revokeUserSessions } from '../../auth/session-revocation';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { PASSWORD_HASH_ROUNDS } from '../../common/constants/auth.constants';
import { APP_ENVIRONMENT } from '../../common/constants/env.constants';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { actorFrom, isSuperAdminActor } from '../../common/security/actor';
import { isDuplicateKeyError } from '../../common/utils/db-error.util';
import { paginate } from '../../common/utils/pagination.util';
import { likeContainsPattern } from '../../common/utils/search-text.util';
import { generateSecureToken, hashSecureToken } from '../../common/utils/secure-token.util';
import { resolveAppEnvironment } from '../../config/runtime-config';
import { MailService } from '../../mail/mail.service';
import { Customer, CustomerAccountStatus } from '../customer/entities/customer.entity';
import { CustomerService } from '../customer/customer.service';
import { CustomerDepositDetails, CustomerInvitationIssueOptions, CustomerInvitationIssuer } from '../customer/customer-invitation.port';
import { IamService } from '../iam/iam.service';
import { SYSTEM_TEMPLATE_KEY } from '../email-template/email-template.constants';
import { EmailTemplateService } from '../email-template/email-template.service';
import { emailLocaleOf, formatExpiryTime, maskEmailAddress } from '../email-template/mail-text.util';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { UserRoleService } from '../user-role/user-role.service';
import {
  INVITATION_AUDIT_ACTION,
  INVITATION_AUDIT_MODULE,
  INVITATION_CANCEL_REASON,
  INVITATION_ENV,
  INVITATION_LIFETIME_HOURS,
  INVITATION_MAIL_PURPOSE,
  INVITATION_MAX_CREATED_PER_ACTOR_PER_HOUR,
  INVITATION_MAX_SENDS,
  INVITATION_MESSAGE,
  INVITATION_PRINCIPAL,
  INVITATION_RESEND_COOLDOWN_SECONDS,
  INVITATION_SEND_ERROR_MAX_LENGTH,
  INVITATION_STATUS,
  INVITATION_WEB_PATH,
  InvitationPrincipal,
  InvitationStatus,
} from './account-invitation.constants';
import { AcceptInvitationDto, InvitationQueryDto, InviteStaffDto, ValidateInvitationDto } from './dto/account-invitation.dto';
import { AccountInvitation } from './entities/account-invitation.entity';

/** `DATE_ADD(NOW(6), INTERVAL 24 HOUR)`: the expiry is stamped by the database, the same clock every later comparison uses. */
const EXPIRY_SQL = `DATE_ADD(NOW(6), INTERVAL ${INVITATION_LIFETIME_HOURS} HOUR)`;

export type InvitationSendStatus = 'SENT' | 'FAILED' | 'NOT_SENT';

export interface InvitationView {
  id: number;
  principalType: InvitationPrincipal;
  principalId: number;
  recipientName: string;
  email: string;
  /** PENDING, ACCEPTED, EXPIRED or CANCELLED — a pending invitation past its expiry already reads EXPIRED. */
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  /** The last delivery attempt (successful or not). */
  lastSentAt: Date | null;
  sentCount: number;
  sendStatus: InvitationSendStatus;
  /** Why the last delivery failed; null when it did not. Never a link or a token. */
  lastSendError: string | null;
  /** Who issued (or last re-sent) it; null when the system did. */
  invitedBy: string | null;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

export interface InvitationDelivery {
  sent: boolean;
  error?: string;
}

export interface IssueResult {
  invitation: InvitationView;
  delivery: InvitationDelivery;
}

export interface InviteStaffResult extends IssueResult {
  user: { id: number; firstName: string; lastName: string; email: string };
}

export interface InvitationCapability {
  enabled: true;
  /** Whether the server has SMTP settings, so an invitation e-mail can be sent at all. */
  emailConfigured: boolean;
  lifetimeHours: number;
}

/** What the service needs to know about an account to invite it, read the same way for both kinds. */
interface AccountSnapshot {
  type: InvitationPrincipal;
  id: number;
  email: string | null;
  firstName: string;
  lastName: string;
  locale: 'en' | 'ar';
  /** The account exists, is not deleted and is still waiting for its owner to set it up. */
  awaitingSetup: boolean;
}

type PortalBase = { url: string } | { error: string };

const sameEmail = (a: string | null | undefined, b: string | null | undefined): boolean =>
  typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Delivery error text is stored, logged, audited and shown to administrators, so it must never carry a link or a token: some mail gateways
 *  quote the message they reject in their reply, and a quoted `…/accept-invitation?token=…` would be a live credential. Links are replaced
 *  first (a token inside one goes with it), then any bare 64-character hex string — the shape of every token this module issues. */
const redactSecrets = (text: string): string => text.replace(/https?:\/\/\S+/gi, '[link]').replace(/\b[a-f0-9]{64}\b/gi, '[redacted]');

const describeError = (error: unknown): string =>
  redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, INVITATION_SEND_ERROR_MAX_LENGTH);

/**
 * Account invitations for BOTH kinds of account — a staff user and a customer — through ONE mechanism, with their roles and permissions kept
 * entirely apart: an invitation never carries a role or a permission. The account (and, for staff, its roles) is created first, by the
 * existing paths and checks, inactive and without a password; the invitation only links to it and lets its owner choose a first password.
 * So nothing a stranger sends when accepting — a token and a password — can change what the account is allowed to do.
 *
 * Security properties, all enforced here:
 *  - the token is 32 random bytes; only its SHA-256 is stored; it exists in the e-mailed link and nowhere else (never logged, never audited);
 *  - one row per account: a re-send replaces the token (so the earlier link stops working), expiry is 24 hours from the database clock;
 *  - accepting is one atomic conditional UPDATE (`status = 'PENDING' AND expires_at > NOW(6)`): of two simultaneous requests only one wins;
 *  - acceptance re-checks the account (still waiting for setup, same e-mail) under a row lock, and refuses — cancelling the invitation —
 *    when it changed since the link was sent;
 *  - every refusal of a public link reads the same, whatever the reason;
 *  - issuing, re-sending and cancelling are checked against the caller's permission for that kind of account and, for staff, the
 *    assignment boundary; creation and re-sending are rate-limited per administrator and per invitation.
 */
@Injectable()
export class AccountInvitationService implements CustomerInvitationIssuer {
  private readonly logger = new Logger(AccountInvitationService.name);

  constructor(
    @InjectRepository(AccountInvitation)
    private readonly invitations: Repository<AccountInvitation>,
    @InjectRepository(User)
    private readonly userRows: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly templates: EmailTemplateService,
    private readonly audit: AuditService,
    private readonly users: UserService,
    private readonly userRoles: UserRoleService,
    private readonly customers: CustomerService,
    private readonly iam: IamService,
  ) {}

  // ── Capability ────────────────────────────────────────────────────────────────────────────────

  capability(): InvitationCapability {
    return { enabled: true, emailConfigured: this.mail.isConfigured(), lifetimeHours: INVITATION_LIFETIME_HOURS };
  }

  // ── Issuing ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a staff account WITHOUT a password and invites it. The account is created through UserService.create — the very path (and the
   * very checks: role grant limits, unique e-mail / mobile / employee code, mandatory fields) as Create User — inactive and with no password;
   * it becomes active when its owner accepts. If the e-mail cannot be sent the account and its invitation still exist: the result says so and
   * the invitation can be re-sent.
   */
  async inviteStaff(dto: InviteStaffDto, principal: AuthenticatedUser): Promise<InviteStaffResult> {
    this.assertSuperAdmin(principal);
    const actor = actorFrom(principal);
    await this.assertCreationRate(principal.sub);

    // `language` is not a user detail: it says which language the invitation (and the page its link opens) is in.
    const { language, ...details } = dto;
    const input: CreateUserDto = { ...details, active: false, mustChangePassword: false };
    const created = await this.users.create(input, actor);

    // It becomes the new user's own language — set BEFORE the invitation is issued, because a message is written in the language of the
    // account it is for (the e-mail, the acceptance page and the user's first sign-in then all agree). Left out: the account has none, English.
    if (language) await this.userRows.update(created.id, { preferredLanguageCode: language });

    const issued = await this.issue({ type: INVITATION_PRINCIPAL.STAFF, id: created.id, actorId: principal.sub });
    return { ...issued, user: { id: created.id, firstName: created.firstName, lastName: created.lastName, email: created.email } };
  }

  /** Sends an invitation to an EXISTING staff account that is still waiting to be set up (inactive, no password) and has none yet, or re-sends it. */
  async inviteExistingStaff(userId: number, principal: AuthenticatedUser): Promise<IssueResult> {
    await this.assertMayIssueStaffLink(principal, userId, 'send an invitation to');
    // The first invitation of an account counts towards the administrator's hourly creation limit, however the account itself came to be.
    const existing = await this.invitations.findOne({ where: { principalType: INVITATION_PRINCIPAL.STAFF, principalId: userId }, select: { id: true } });
    if (!existing) await this.assertCreationRate(principal.sub);
    return this.issue({ type: INVITATION_PRINCIPAL.STAFF, id: userId, actorId: principal.sub, enforceSendLimits: true });
  }

  /** Re-sends an invitation: the earlier link stops working, a new one is valid for another 24 hours. */
  async resend(id: number, principal: AuthenticatedUser): Promise<IssueResult> {
    const invitation = await this.findOrFail(id);
    if (invitation.principalType === INVITATION_PRINCIPAL.STAFF) {
      await this.assertMayIssueStaffLink(principal, invitation.principalId, 'resend the invitation of');
    } else {
      await this.assertMayManage(invitation.principalType, principal);
    }
    return this.issue({ type: invitation.principalType, id: invitation.principalId, actorId: principal.sub, enforceSendLimits: true });
  }

  /**
   * The customer's activation e-mail as an account invitation (CustomerService asks for this through CUSTOMER_INVITATION_ISSUER). Called by
   * the approval of a registration (no `actorId`) or by a staff member re-sending it (`actorId`; the cooldown and the send cap apply to that).
   * Any activation link issued the old way that is still unused is withdrawn by CustomerService before this runs, so a re-send leaves one
   * working link.
   */
  async issueForCustomer(customerId: number, options: CustomerInvitationIssueOptions = {}): Promise<InvitationDelivery> {
    const result = await this.issue({
      type: INVITATION_PRINCIPAL.CUSTOMER,
      id: customerId,
      actorId: options.actorId ?? null,
      deposit: options.deposit,
      // The system's own send (an approved registration) is not rate-limited; a staff member re-sending is.
      enforceSendLimits: options.actorId !== undefined,
    });
    return result.delivery;
  }

  /**
   * Whether an invitation can be issued for this customer right now: the account is still waiting to be set up. CustomerService asks before it
   * hands an activation e-mail to this module, and keeps sending that e-mail the way it always has for every other customer (an ACTIVE one for
   * whom a deposit demand is raised again, an OVERDUE one), so the invitation module never makes those e-mails fail.
   */
  async canIssueForCustomer(customerId: number): Promise<boolean> {
    const account = await this.loadAccount(this.dataSource.manager, INVITATION_PRINCIPAL.CUSTOMER, customerId, false);
    return account !== null && account.awaitingSetup;
  }

  /**
   * Writes the invitation (new, or re-opened with a new token) inside one transaction that also locks the account, then — after it commits —
   * sends the message and records how the delivery went. The raw token lives only in this method's local variables.
   */
  private async issue(input: {
    type: InvitationPrincipal;
    id: number;
    actorId: number | null;
    /** A customer whose approval raised a Security Deposit: the invitation is then the managed deposit message. */
    deposit?: CustomerDepositDetails;
    /** An administrator re-sending: the cooldown and the send cap are checked HERE, under the account's row lock, so parallel requests for the
     *  same account take turns and every later one sees the earlier one's stamp (see `lastSentAt` below). */
    enforceSendLimits?: boolean;
  }): Promise<IssueResult> {
    const base = this.portalBase(input.type);

    let issued: { invitationId: number; rawToken: string; isNew: boolean; account: AccountSnapshot & { email: string } };
    try {
      issued = await this.dataSource.transaction(async (manager) => {
        const account = await this.loadAccount(manager, input.type, input.id, true);
        if (!account) throw new NotFoundException(INVITATION_MESSAGE.NOT_FOUND);
        if (!account.awaitingSetup) throw new ConflictException(INVITATION_MESSAGE.ACCOUNT_NOT_AWAITING_SETUP);
        if (!account.email) throw new BadRequestException(INVITATION_MESSAGE.NO_EMAIL);

        const rawToken = generateSecureToken();
        const tokenHash = hashSecureToken(rawToken);
        const recipientName = `${account.firstName} ${account.lastName}`.trim().slice(0, 200);
        const fields = {
          email: account.email,
          recipientName,
          tokenHash,
          status: INVITATION_STATUS.PENDING,
          acceptedAt: null,
          cancelledAt: null,
          cancelReason: null,
          expiredNotifiedAt: null,
          lastSendError: null,
          createdBy: input.actorId,
        };

        // A plain read, deliberately NOT a locking one. The account row lock above already makes every issuer of THIS account take turns, and a
        // FOR UPDATE on a key that does not exist yet only takes a gap lock on the unique index: two first-time invitations for different
        // accounts would each hold that gap lock and then deadlock on each other's INSERT (the hazard UserRoleService.addRolesToUser documents).
        // The first consistent read of this transaction happens here — after the account lock was granted — so it sees whatever the previous
        // issuer of the account committed.
        const existing = await manager.getRepository(AccountInvitation).findOne({ where: { principalType: input.type, principalId: input.id } });
        if (existing && input.enforceSendLimits) await this.assertMayResend(existing, manager);

        let invitationId: number;
        if (existing) {
          await manager
            .createQueryBuilder()
            .update(AccountInvitation)
            .set({
              ...fields,
              expiresAt: () => EXPIRY_SQL,
              // Stamped now, in the same transaction that rotates the token, so the cooldown holds even while the e-mail is still being sent
              // (deliver() records only how it went). The column reads "last delivery attempt".
              lastSentAt: () => 'NOW(6)',
              // A live invitation keeps counting towards its send cap; one that was accepted, cancelled or ran out starts a new round.
              ...(existing.status === INVITATION_STATUS.PENDING ? {} : { sentCount: 0 }),
            })
            .where('id = :id', { id: existing.id })
            .execute();
          invitationId = existing.id;
        } else {
          const result = await manager
            .createQueryBuilder()
            .insert()
            .into(AccountInvitation)
            .values({
              ...fields,
              principalType: input.type,
              principalId: input.id,
              expiresAt: () => EXPIRY_SQL,
              sentCount: 0,
              lastSentAt: () => 'NOW(6)',
            })
            .execute();
          invitationId = Number(result.identifiers[0].id);
        }

        await this.audit.record(
          {
            moduleName: INVITATION_AUDIT_MODULE,
            entityId: invitationId,
            action: existing ? INVITATION_AUDIT_ACTION.RESENT : INVITATION_AUDIT_ACTION.CREATED,
            newValue: { principalType: input.type, principalId: input.id },
            performedBy: input.actorId,
          },
          manager,
        );
        return { invitationId, rawToken, isNew: !existing, account: { ...account, email: account.email } };
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictException('An invitation for this account is being created right now. Please try again.');
      throw error;
    }

    const invitation = await this.invitations.findOneOrFail({ where: { id: issued.invitationId } });
    // A raised deposit always uses the deposit message — on a re-send too, since the customer still has to pay it; otherwise the first message is
    // the staff or customer invitation and a later one the "resent" message.
    const templateKey = input.deposit
      ? SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION
      : issued.isNew
        ? input.type === INVITATION_PRINCIPAL.STAFF
          ? SYSTEM_TEMPLATE_KEY.STAFF_INVITATION
          : SYSTEM_TEMPLATE_KEY.CUSTOMER_INVITATION
        : SYSTEM_TEMPLATE_KEY.INVITATION_RESENT;
    const delivery = await this.deliver(invitation, issued.rawToken, issued.account, {
      templateKey,
      invitedBy: await this.inviterName(input.actorId),
      extraValues: input.deposit ? { customerReference: input.deposit.customerReference, depositAmount: input.deposit.amountLabel } : undefined,
      base,
    });
    const view = this.toView(await this.invitations.findOneOrFail({ where: { id: issued.invitationId } }), await this.namesFor([input.actorId]));
    return { invitation: view, delivery };
  }

  /** Sends the message and records the attempt. A failure is reported, never thrown: the invitation exists and can be re-sent. */
  private async deliver(
    invitation: AccountInvitation,
    rawToken: string,
    account: AccountSnapshot,
    options: { templateKey: string; invitedBy: string; extraValues?: Record<string, string>; base: PortalBase },
  ): Promise<InvitationDelivery> {
    let result: InvitationDelivery;
    try {
      if ('error' in options.base) {
        result = { sent: false, error: options.base.error };
      } else {
        const link = `${options.base.url}${INVITATION_WEB_PATH.ACCEPT}?token=${rawToken}`;
        const message = await this.templates.render(options.templateKey, account.locale, {
          firstName: account.firstName,
          lastName: account.lastName,
          email: invitation.email,
          invitedBy: options.invitedBy,
          invitationLink: link,
          expiryTime: formatExpiryTime(invitation.expiresAt, INVITATION_LIFETIME_HOURS, account.locale),
          ...options.extraValues,
        });
        result = await this.mail.send({
          to: invitation.email,
          subject: message.subject,
          html: message.html,
          text: message.text,
          purpose: INVITATION_MAIL_PURPOSE.INVITATION,
        });
      }
    } catch (error) {
      result = { sent: false, error: describeError(error) };
    }

    // Only a message that really went out counts towards the send cap (a failed attempt does not use it up), and the stored reason can never
    // carry a link or a token. The attempt time itself was stamped by issue(), in the transaction that rotated the token.
    const error = result.sent ? null : redactSecrets(result.error ?? 'The invitation e-mail could not be sent').slice(0, INVITATION_SEND_ERROR_MAX_LENGTH);
    await this.invitations
      .createQueryBuilder()
      .update(AccountInvitation)
      .set({ ...(result.sent ? { sentCount: () => 'sent_count + 1' } : {}), lastSendError: error })
      .where('id = :id', { id: invitation.id })
      .execute();

    if (!result.sent) {
      this.logger.warn(`Invitation ${invitation.id} could not be sent: ${error}`);
      await this.audit.record({
        moduleName: INVITATION_AUDIT_MODULE,
        entityId: invitation.id,
        action: INVITATION_AUDIT_ACTION.SEND_FAILED,
        newValue: { principalType: invitation.principalType, principalId: invitation.principalId, error },
      });
    }
    return error === null ? { sent: true } : { sent: false, error };
  }

  // ── Cancelling ────────────────────────────────────────────────────────────────────────────────

  async cancel(id: number, principal: AuthenticatedUser): Promise<InvitationView> {
    const invitation = await this.findOrFail(id);
    if (invitation.principalType === INVITATION_PRINCIPAL.STAFF) this.assertSuperAdmin(principal);
    await this.assertMayManage(invitation.principalType, principal);
    if (invitation.principalType === INVITATION_PRINCIPAL.STAFF) {
      const actor = actorFrom(principal);
      // A super administrator's account is only ever handled by a super administrator, here too.
      await this.userRoles.assertActorMayModifyUser(actor, invitation.principalId);
      await this.userRoles.assertActorMayTakeOverAccount(actor, invitation.principalId, 'cancel the invitation of');
    }

    const result = await this.invitations
      .createQueryBuilder()
      .update(AccountInvitation)
      .set({ status: INVITATION_STATUS.CANCELLED, cancelledAt: () => 'NOW(6)', cancelReason: INVITATION_CANCEL_REASON.ADMINISTRATOR })
      .where("id = :id AND status IN ('PENDING', 'EXPIRED')", { id })
      .execute();
    if (result.affected !== 1) throw new ConflictException('Only a pending or expired invitation can be cancelled');

    await this.audit.record({
      moduleName: INVITATION_AUDIT_MODULE,
      entityId: id,
      action: INVITATION_AUDIT_ACTION.CANCELLED,
      newValue: { reason: INVITATION_CANCEL_REASON.ADMINISTRATOR, principalType: invitation.principalType, principalId: invitation.principalId },
      performedBy: principal.sub,
    });
    return this.toView(await this.findOrFail(id), await this.namesFor([invitation.createdBy]));
  }

  /**
   * Withdraws the invitation of an account that changed under it — its e-mail was edited, it was deactivated or deleted (called by
   * AccountInvitationSubscriber, inside the transaction that made the change, so both commit or neither does). Only a pending or expired
   * invitation is touched; an accepted one is history.
   */
  async cancelForAccount(type: InvitationPrincipal, id: number, reason: string, manager?: EntityManager): Promise<void> {
    const runner = manager ?? this.dataSource.manager;
    const rows = await runner.getRepository(AccountInvitation).find({
      where: { principalType: type, principalId: id, status: In<InvitationStatus>([INVITATION_STATUS.PENDING, INVITATION_STATUS.EXPIRED]) },
      select: { id: true },
    });
    for (const row of rows) {
      // The status is checked again inside the UPDATE itself. The SELECT above can be an older snapshot (this runs inside the transaction of
      // an edit that began before an acceptance committed): without this condition the edit would turn that ACCEPTED invitation into a
      // CANCELLED one (found by racing an acceptance against an e-mail edit of the same account). An UPDATE reads the latest committed row.
      const result = await runner
        .createQueryBuilder()
        .update(AccountInvitation)
        .set({ status: INVITATION_STATUS.CANCELLED, cancelledAt: () => 'NOW(6)', cancelReason: reason })
        .where("id = :id AND status IN ('PENDING', 'EXPIRED')", { id: row.id })
        .execute();
      if (result.affected !== 1) continue;
      await this.audit.record(
        {
          moduleName: INVITATION_AUDIT_MODULE,
          entityId: row.id,
          action: INVITATION_AUDIT_ACTION.CANCELLED,
          newValue: { reason, principalType: type, principalId: id },
        },
        runner,
      );
    }
  }

  // ── Reading ───────────────────────────────────────────────────────────────────────────────────

  /** The invitations the caller may see: staff ones need VIEW_USER, customer ones VIEW_CUSTOMER. */
  async list(query: InvitationQueryDto, principal: AuthenticatedUser): Promise<PaginatedResult<InvitationView>> {
    const granted = await this.grantedCodes(principal);
    const allowed: InvitationPrincipal[] = [];
    // Staff invitations belong to the Administration Console: VIEW_USER is not enough on its own, the caller must be a super administrator.
    if (granted.has(ACTION_CODES.VIEW_USER) && this.isSuperAdmin(principal)) allowed.push(INVITATION_PRINCIPAL.STAFF);
    if (granted.has(ACTION_CODES.VIEW_CUSTOMER)) allowed.push(INVITATION_PRINCIPAL.CUSTOMER);
    if (allowed.length === 0) throw new ForbiddenException(INVITATION_MESSAGE.MAY_NOT_VIEW);
    if (query.principalType && !allowed.includes(query.principalType)) throw new ForbiddenException(INVITATION_MESSAGE.MAY_NOT_VIEW);

    const qb = this.invitations.createQueryBuilder('i').where('i.principal_type IN (:...allowed)', { allowed });
    if (query.principalType) qb.andWhere('i.principal_type = :principalType', { principalType: query.principalType });
    if (query.principalId !== undefined) qb.andWhere('i.principal_id = :principalId', { principalId: query.principalId });

    if (query.status === INVITATION_STATUS.PENDING) {
      qb.andWhere("i.status = 'PENDING' AND i.expires_at > NOW(6)");
    } else if (query.status === INVITATION_STATUS.EXPIRED) {
      qb.andWhere("(i.status = 'EXPIRED' OR (i.status = 'PENDING' AND i.expires_at <= NOW(6)))");
    } else if (query.status) {
      qb.andWhere('i.status = :status', { status: query.status });
    }
    // % and _ in the search text are literal characters (likeContainsPattern escapes them), as in every other list of this project.
    const term = query.search?.trim();
    if (term) qb.andWhere('(i.email LIKE :search OR i.recipient_name LIKE :search)', { search: likeContainsPattern(term) });
    qb.orderBy('i.createdAt', 'DESC').addOrderBy('i.id', 'DESC');

    const page = await paginate(qb, query);
    const names = await this.namesFor(page.items.map((item) => item.createdBy));
    return { items: page.items.map((item) => this.toView(item, names)), pagination: page.pagination };
  }

  /** The first name and masked address behind a link, so the acceptance page can greet the person — and the language the e-mail was written in,
   *  so the page opens in the same one (and right to left when it is Arabic). Nothing else. */
  async validate(
    dto: ValidateInvitationDto,
  ): Promise<{ firstName: string; email: string; principalType: InvitationPrincipal; expiresAt: Date; locale: 'en' | 'ar' }> {
    const invitation = await this.findUsable(hashSecureToken(dto.token));
    if (!invitation) throw new BadRequestException(INVITATION_MESSAGE.INVALID_LINK);
    const account = await this.loadAccount(this.dataSource.manager, invitation.principalType, invitation.principalId, false);
    if (!account || !account.awaitingSetup || !sameEmail(account.email, invitation.email)) {
      throw new BadRequestException(INVITATION_MESSAGE.INVALID_LINK);
    }
    return {
      firstName: account.firstName,
      email: maskEmailAddress(invitation.email),
      principalType: invitation.principalType,
      expiresAt: invitation.expiresAt,
      locale: account.locale,
    };
  }

  // ── Accepting ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Consumes the link: the person's own password is stored, the account becomes usable and the acceptance is audited — all in one
   * transaction. The only inputs are the token and the password; which account, and what it may do, come from the server's own rows.
   */
  async accept(dto: AcceptInvitationDto): Promise<{ accepted: true; accountActive: boolean }> {
    const tokenHash = hashSecureToken(dto.token);
    // A cheap read first, so a made-up token costs no password hashing. It also says which account the link is for, so the transaction below can
    // lock that account BEFORE it claims the link: issuing and the entity subscriber take the account row first and the invitation row second,
    // and taking them in the same order here keeps an acceptance and an edit of the same account from deadlocking.
    const preliminary = await this.findUsable(tokenHash);
    if (!preliminary) throw new BadRequestException(INVITATION_MESSAGE.INVALID_LINK);
    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);

    const outcome = await this.dataSource.transaction(async (manager) => {
      const account = await this.loadAccount(manager, preliminary.principalType, preliminary.principalId, true);

      // The single-use claim: the database decides, on its own clock, whether this link is still good — and exactly one request can win it.
      const claim = await manager
        .createQueryBuilder()
        .update(AccountInvitation)
        .set({ status: INVITATION_STATUS.ACCEPTED, acceptedAt: () => 'NOW(6)' })
        .where("token_hash = :tokenHash AND status = 'PENDING' AND expires_at > NOW(6)", { tokenHash })
        .execute();
      if (claim.affected !== 1) return { ok: false as const };

      const invitation = await manager.getRepository(AccountInvitation).findOne({ where: { tokenHash } });
      if (!invitation) return { ok: false as const };

      if (!account || !account.awaitingSetup || !sameEmail(account.email, invitation.email)) {
        // The account is gone, was deactivated, set up another way or changed its address since the link was sent: the link is withdrawn
        // (and that is committed), the acceptance is refused.
        await manager
          .createQueryBuilder()
          .update(AccountInvitation)
          .set({ status: INVITATION_STATUS.CANCELLED, acceptedAt: null, cancelledAt: () => 'NOW(6)', cancelReason: INVITATION_CANCEL_REASON.ACCOUNT_NOT_AWAITING_SETUP })
          .where('id = :id', { id: invitation.id })
          .execute();
        await this.audit.record(
          {
            moduleName: INVITATION_AUDIT_MODULE,
            entityId: invitation.id,
            action: INVITATION_AUDIT_ACTION.CANCELLED,
            newValue: { reason: INVITATION_CANCEL_REASON.ACCOUNT_NOT_AWAITING_SETUP, principalType: invitation.principalType, principalId: invitation.principalId },
          },
          manager,
        );
        return { ok: false as const };
      }

      // Whether the account can be used now: a staff account always can; a customer's only when its Security Deposit is already resolved (a
      // customer who still owes one has a password but stays INACTIVE until the deposit is verified, exactly as with the legacy link).
      let activated = true;
      if (invitation.principalType === INVITATION_PRINCIPAL.STAFF) {
        // Roles were granted when the account was created, by someone allowed to grant them; accepting changes none of that.
        await manager.getRepository(User).update(account.id, { passwordHash, passwordUpdatedAt: new Date(), mustChangePassword: false, active: true });
      } else {
        ({ activated } = await this.customers.completeAccountSetup(account.id, passwordHash, manager));
      }
      // A new credential ends every session the previous one (or a stolen refresh cookie) could have opened — as every other password change does.
      // A first-time invitee has none, so for them this is a no-op.
      await revokeUserSessions(manager, invitation.principalType, account.id);

      await this.audit.record(
        {
          moduleName: INVITATION_AUDIT_MODULE,
          entityId: invitation.id,
          action: INVITATION_AUDIT_ACTION.ACCEPTED,
          newValue: { principalType: invitation.principalType, principalId: invitation.principalId, sessionsRevoked: true, accountActive: activated },
          performedBy: invitation.principalType === INVITATION_PRINCIPAL.STAFF ? account.id : undefined,
        },
        manager,
      );
      return { ok: true as const, invitation, account, activated };
    });

    if (!outcome.ok) throw new BadRequestException(INVITATION_MESSAGE.INVALID_LINK);
    // "Your account is ready" is only true when it is: a customer who still owes a Security Deposit was already told, in the invitation, that the
    // account activates once the payment is verified — telling them it is ready now would be wrong.
    if (outcome.activated) await this.notifyActivated(outcome.invitation, outcome.account);
    // `accountActive` lets the page say the right thing: "your account is ready" — or, for a customer who still owes a Security Deposit, that the
    // password is set and the account activates once the payment is verified. It tells nobody anything they could not see by signing in.
    return { accepted: true, accountActive: outcome.activated };
  }

  /** The "Account Activated" message — best effort: the account is active whether or not it can be delivered. */
  private async notifyActivated(invitation: AccountInvitation, account: AccountSnapshot): Promise<void> {
    try {
      const base = this.portalBase(invitation.principalType);
      if ('error' in base) return;
      const message = await this.templates.render(SYSTEM_TEMPLATE_KEY.ACCOUNT_ACTIVATED, account.locale, {
        firstName: account.firstName,
        lastName: account.lastName,
        email: invitation.email,
        invitedBy: await this.inviterName(invitation.createdBy),
        signInLink: `${base.url}${INVITATION_WEB_PATH.SIGN_IN}`,
      });
      await this.mail.send({ to: invitation.email, subject: message.subject, html: message.html, text: message.text, purpose: INVITATION_MAIL_PURPOSE.ACTIVATED });
    } catch (error) {
      this.logger.warn(`The activation confirmation for invitation ${invitation.id} could not be sent: ${describeError(error)}`);
    }
  }

  // ── Expiry ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Marks invitations whose time ran out as EXPIRED, audits each, and sends the "Invitation Expired" message — once, to the invitee only.
   * Safe to run on several instances at once: each row changes state by a conditional UPDATE that only one of them can win. Returns how many
   * it expired. (There is no in-app notification system to tell the inviting administrator; the Invitations screen shows the status.)
   */
  async expireDue(): Promise<number> {
    const due = await this.invitations
      .createQueryBuilder('i')
      .select(['i.id'])
      .where("i.status = 'PENDING' AND i.expires_at <= NOW(6)")
      .orderBy('i.id', 'ASC')
      .limit(100)
      .getMany();

    let expired = 0;
    for (const row of due) {
      const claim = await this.invitations
        .createQueryBuilder()
        .update(AccountInvitation)
        .set({ status: INVITATION_STATUS.EXPIRED })
        .where("id = :id AND status = 'PENDING' AND expires_at <= NOW(6)", { id: row.id })
        .execute();
      if (claim.affected !== 1) continue;
      expired += 1;

      const invitation = await this.invitations.findOne({ where: { id: row.id } });
      if (!invitation) continue;
      await this.audit.record({
        moduleName: INVITATION_AUDIT_MODULE,
        entityId: invitation.id,
        action: INVITATION_AUDIT_ACTION.EXPIRED,
        newValue: { principalType: invitation.principalType, principalId: invitation.principalId },
      });
      await this.notifyExpired(invitation);
    }
    return expired;
  }

  private async notifyExpired(invitation: AccountInvitation): Promise<void> {
    try {
      const account = await this.loadAccount(this.dataSource.manager, invitation.principalType, invitation.principalId, false);
      // Nobody to tell if the account is gone or was set up another way meanwhile.
      if (!account || !account.awaitingSetup || !sameEmail(account.email, invitation.email)) return;

      const message = await this.templates.render(SYSTEM_TEMPLATE_KEY.INVITATION_EXPIRED, account.locale, {
        firstName: account.firstName,
        lastName: account.lastName,
        email: invitation.email,
        invitedBy: await this.inviterName(invitation.createdBy),
      });
      const result = await this.mail.send({
        to: invitation.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        purpose: INVITATION_MAIL_PURPOSE.EXPIRED,
      });
      if (result.sent) {
        await this.invitations
          .createQueryBuilder()
          .update(AccountInvitation)
          .set({ expiredNotifiedAt: () => 'NOW(6)' })
          .where('id = :id', { id: invitation.id })
          .execute();
      }
    } catch (error) {
      this.logger.warn(`The expiry notice for invitation ${invitation.id} could not be sent: ${describeError(error)}`);
    }
  }

  // ── Checks ────────────────────────────────────────────────────────────────────────────────────

  /** Whether the caller is a super administrator, judged from the live role names JwtStrategy re-reads on every request. */
  private isSuperAdmin(principal: AuthenticatedUser): boolean {
    return isSuperAdminActor(actorFrom(principal));
  }

  /** Staff invitations are managed by a SUPER_ADMIN only. This is checked here IN ADDITION to the Users permission codes (which the server already
   *  withholds from every other role, see administration-permissions.ts), so the rule does not depend on how those codes are granted. */
  private assertSuperAdmin(principal: AuthenticatedUser): void {
    if (!this.isSuperAdmin(principal)) throw new ForbiddenException(INVITATION_MESSAGE.STAFF_SUPER_ADMIN_ONLY);
  }

  /** The Action codes the caller holds right now (live roles plus their own inline policies). */
  private grantedCodes(principal: AuthenticatedUser): Promise<Set<string>> {
    return this.iam.getActionCodesGrantedByPoliciesForRoles(principal.roleIds ?? [principal.roleId], principal.sub);
  }

  /** 403 unless the caller may edit this KIND of account (EDIT_USER for staff, EDIT_CUSTOMER for customers). The route only knows "either". */
  private async assertMayManage(type: InvitationPrincipal, principal: AuthenticatedUser): Promise<void> {
    const needed = type === INVITATION_PRINCIPAL.STAFF ? ACTION_CODES.EDIT_USER : ACTION_CODES.EDIT_CUSTOMER;
    if (!(await this.grantedCodes(principal)).has(needed)) throw new ForbiddenException(INVITATION_MESSAGE.MAY_NOT_MANAGE);
  }

  /**
   * What it takes to send (or re-send) the link that lets someone choose an EXISTING staff account's first password. That is what a password
   * reset does — whoever holds the mailbox gets a working login — and EDIT_USER can change the account's e-mail address, so EDIT_USER alone
   * must not be enough: it also takes RESET_USER_PASSWORD, a super administrator's account is only ever handled by a super administrator, and
   * the assignment boundary applies (the same three rules as AuthService.adminResetPassword). Creating a NEW staff account with an invitation
   * is covered by CREATE_USER, exactly as creating one with a temporary password is.
   */
  private async assertMayIssueStaffLink(principal: AuthenticatedUser, userId: number, action: string): Promise<void> {
    this.assertSuperAdmin(principal);
    const granted = await this.grantedCodes(principal);
    if (!granted.has(ACTION_CODES.EDIT_USER) || !granted.has(ACTION_CODES.RESET_USER_PASSWORD)) {
      throw new ForbiddenException(INVITATION_MESSAGE.MAY_NOT_ISSUE_STAFF_LINK);
    }
    const actor = actorFrom(principal);
    await this.userRoles.assertActorMayModifyUser(actor, userId);
    await this.userRoles.assertActorMayTakeOverAccount(actor, userId, action);
  }

  /** The send limits of one invitation: not twice in a minute, and not past the cap of a live invitation. Runs inside issue()'s transaction, after
   *  the account row is locked, so parallel requests for one account take turns. Whether the ACCOUNT may be invited again (it is still waiting to
   *  be set up) is decided there too. */
  private async assertMayResend(invitation: AccountInvitation, manager: EntityManager): Promise<void> {
    // The cap stops a LIVE invitation from being re-sent without end. One that was accepted, cancelled or ran out starts a new round when it is
    // re-opened (issue() resets the count), so "cancel it and invite the person again" works.
    if (invitation.status === INVITATION_STATUS.PENDING && invitation.sentCount >= INVITATION_MAX_SENDS) {
      throw new HttpException(INVITATION_MESSAGE.TOO_MANY_SENDS, HttpStatus.TOO_MANY_REQUESTS);
    }

    const row = await manager
      .getRepository(AccountInvitation)
      .createQueryBuilder('i')
      .select('TIMESTAMPDIFF(SECOND, i.last_sent_at, NOW(6))', 'seconds')
      .where('i.id = :id', { id: invitation.id })
      .getRawOne<{ seconds: string | number | null }>();
    const rawSeconds = row?.seconds;
    const seconds = rawSeconds === null || rawSeconds === undefined ? null : Number(rawSeconds);
    if (seconds !== null && seconds < INVITATION_RESEND_COOLDOWN_SECONDS) {
      throw new HttpException(INVITATION_MESSAGE.RESEND_TOO_SOON, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async assertCreationRate(actorId: number): Promise<void> {
    const recent = await this.invitations
      .createQueryBuilder('i')
      .where('i.created_by = :actorId', { actorId })
      .andWhere('i.created_at > DATE_SUB(NOW(6), INTERVAL 1 HOUR)')
      .getCount();
    if (recent >= INVITATION_MAX_CREATED_PER_ACTOR_PER_HOUR) {
      throw new HttpException(INVITATION_MESSAGE.TOO_MANY_CREATED, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────────────────────

  private async findOrFail(id: number): Promise<AccountInvitation> {
    const invitation = await this.invitations.findOne({ where: { id } });
    if (!invitation) throw new NotFoundException(INVITATION_MESSAGE.NOT_FOUND);
    return invitation;
  }

  /** A link that is still good, judged by the database clock. */
  private findUsable(tokenHash: string): Promise<AccountInvitation | null> {
    return this.invitations
      .createQueryBuilder('i')
      .where('i.token_hash = :tokenHash', { tokenHash })
      .andWhere("i.status = 'PENDING'")
      .andWhere('i.expires_at > NOW(6)')
      .getOne();
  }

  /** The account behind an invitation, read the same way for both kinds. `lock` takes a write lock (inside a transaction). */
  private async loadAccount(manager: EntityManager, type: InvitationPrincipal, id: number, lock: boolean): Promise<AccountSnapshot | null> {
    if (type === INVITATION_PRINCIPAL.STAFF) {
      const qb = manager.getRepository(User).createQueryBuilder('user').addSelect('user.passwordHash').where('user.id = :id', { id });
      if (lock) qb.setLock('pessimistic_write');
      const user = await qb.getOne();
      if (!user) return null;
      return {
        type,
        id: user.id,
        email: user.email ?? null,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: emailLocaleOf(user.preferredLanguageCode),
        // Pending = inactive with no password; an account that was activated, given a password or deactivated is no longer "waiting".
        awaitingSetup: user.active === false && !user.passwordHash,
      };
    }

    // The password hash is a hidden column (select: false); it is read here only to tell "never set a password" from "has one".
    const qb = manager.getRepository(Customer).createQueryBuilder('customer').addSelect('customer.passwordHash').where('customer.id = :id', { id });
    if (lock) qb.setLock('pessimistic_write');
    const customer = await qb.getOne();
    if (!customer) return null;
    const [firstWord = '', ...otherWords] = customer.fullName.trim().split(/\s+/);
    return {
      type,
      id: customer.id,
      email: customer.email ?? null,
      firstName: (customer.firstName ?? firstWord).trim(),
      lastName: (customer.lastName ?? otherWords.join(' ')).trim(),
      locale: emailLocaleOf(customer.preferredLanguage),
      // Waiting for setup = INACTIVE (not activated yet — which also covers a customer who set a password and is waiting on a deposit, or forgot
      // it: the activation e-mail has always been how they get a new one), or ACTIVE but never given a password (a verified deposit activates
      // an account whether or not its owner ever opened the link, and nobody can sign in without one). OVERDUE is a billing suspension that
      // setting up an account must never lift, so it is never "waiting": such customers keep the activation e-mail CustomerService has always sent.
      awaitingSetup:
        customer.accountStatus === CustomerAccountStatus.INACTIVE ||
        (customer.accountStatus === CustomerAccountStatus.ACTIVE && !customer.passwordHash),
    };
  }

  /** The web address invitation links point at, or why there is none. Never taken from the request, and https is required in production. */
  private portalBase(type: InvitationPrincipal): PortalBase {
    const staffUrl = type === INVITATION_PRINCIPAL.STAFF ? this.config.get<string>(INVITATION_ENV.STAFF_PORTAL_URL)?.trim() : undefined;
    const configured = staffUrl || this.config.get<string>(INVITATION_ENV.CUSTOMER_PORTAL_URL)?.trim() || '';
    if (!configured) return { error: INVITATION_MESSAGE.PORTAL_URL_MISSING };

    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      return { error: INVITATION_MESSAGE.PORTAL_URL_INVALID };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: INVITATION_MESSAGE.PORTAL_URL_INVALID };
    if (parsed.protocol !== 'https:' && resolveAppEnvironment(process.env.NODE_ENV) === APP_ENVIRONMENT.PRODUCTION) {
      return { error: INVITATION_MESSAGE.PORTAL_URL_NOT_HTTPS };
    }
    return { url: configured.replace(/\/+$/, '') };
  }

  /** The name shown as "invited by": the administrator who issued it, else the company name (an approval has no person behind it). */
  private async inviterName(actorId: number | null): Promise<string> {
    const names = await this.namesFor([actorId]);
    return (actorId !== null ? names.get(actorId) : undefined) ?? (await this.templates.getCompanyName());
  }

  /** The full names of these staff users (deleted ones too), by id. */
  private async namesFor(ids: Array<number | null>): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.userRows.find({ where: { id: In(unique) }, select: { id: true, firstName: true, lastName: true }, withDeleted: true });
    return new Map(rows.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]));
  }

  private toView(invitation: AccountInvitation, names: Map<number, string>): InvitationView {
    const expired = invitation.status === INVITATION_STATUS.PENDING && invitation.expiresAt.getTime() <= Date.now();
    // From what DELIVERY recorded, not from the attempt time (issue() stamps that before the e-mail is sent): a message counts as sent only once
    // deliver() has counted it, so an invitation whose delivery never finished (a restart mid-send) reads NOT_SENT rather than SENT.
    const sendStatus: InvitationSendStatus = invitation.lastSendError ? 'FAILED' : invitation.sentCount > 0 ? 'SENT' : 'NOT_SENT';
    return {
      id: invitation.id,
      principalType: invitation.principalType,
      principalId: invitation.principalId,
      recipientName: invitation.recipientName,
      email: invitation.email,
      status: expired ? INVITATION_STATUS.EXPIRED : invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      lastSentAt: invitation.lastSentAt,
      sentCount: invitation.sentCount,
      sendStatus,
      lastSendError: invitation.lastSendError,
      invitedBy: invitation.createdBy !== null ? (names.get(invitation.createdBy) ?? null) : null,
      acceptedAt: invitation.acceptedAt,
      cancelledAt: invitation.cancelledAt,
      cancelReason: invitation.cancelReason,
    };
  }
}

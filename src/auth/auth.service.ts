import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Actor, actorUserId } from '../common/security/actor';
import { isStrongPassword } from '../common/validators/strong-password.validator';
import { LoginAttemptsService } from './login-attempts.service';
import { UserService } from '../modules/user/user.service';
import { UserRoleService } from '../modules/user-role/user-role.service';
import { CustomerService } from '../modules/customer/customer.service';
import { CustomerAccountStatus } from '../modules/customer/entities/customer.entity';
import { AttributeService } from '../modules/attribute/attribute.service';
import { LovService } from '../modules/lov/lov.service';
import { RegistrationRequestService } from '../modules/registration-request/registration-request.service';
import { computePortalAccess } from '../modules/registration-request/entities/registration-request.entity';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { LoginHistoryDto } from './dto/login-history-response.dto';
import { BootstrapResponseDto } from './dto/bootstrap-response.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminResetPasswordResponseDto } from './dto/admin-reset-password-response.dto';
import { SigninAccessStatusResponseDto } from './dto/signin-access-status-response.dto';
import { AuthPrincipal } from './interfaces/authenticated-user.interface';
import { DeviceContext } from './interfaces/device-context.interface';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserLoginHistory } from './entities/user-login-history.entity';
import { UserDeviceDto } from './dto/device-response.dto';
import { SessionConfigDto } from './dto/session-config-response.dto';
import { CreateAuditLogDto } from '../audit/dto/create-audit-log.dto';
import { parseUserAgent } from './device-info.util';
import { SessionLivenessService } from './session-liveness.service';
import { SessionScope, findLiveFamilies, revokeUserSessions } from './session-revocation';
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  LOGIN_HISTORY_STATUS,
  SESSION_AUDIT_ACTION,
  SESSION_REVOKE_REASON,
  SESSION_TIMEOUT_WARNING_INTERVAL_MS,
} from './session.constants';
import { DEFAULT_LIMIT } from '../common/constants/pagination.constants';
import { ERROR_MESSAGES } from '../common/constants/error-messages.constants';
import { PRINCIPAL_TYPE, PrincipalType, PASSWORD_HASH_ROUNDS, DEFAULT_REFRESH_TOKEN_EXPIRES_IN, DEFAULT_REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN, TOKEN_TYPE_BEARER, ACTOR_KIND } from '../common/constants/auth.constants';
import { AUDIT_CREDENTIAL_ACTION, AUDIT_MODULE } from '../audit/audit.constants';
import { SORT_ORDER } from '../common/constants/sort.constants';
import { ENV_KEY } from '../common/constants/env.constants';
import { refreshTokenLifetime } from '../config/runtime-config';
import { ATTRIBUTE_KEY } from '../modules/attribute/attribute.constants';
import { DURATION_UNIT_MS } from '../common/constants/time.constants';
import { SECURE_TOKEN_BYTES, HEX_ENCODING, HASH_ALGORITHM } from '../common/constants/crypto.constants';

/** The audit row written with a self-service session action (see AuthService.endSessions). */
interface SessionAudit {
  action: string;
  newValue?: Record<string, unknown>;
  /** Record the action even when no live session was ended (the user still did it). */
  always?: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** When the "session timeout fell back" warning was last logged (see warnSessionTimeoutFallback). */
  private sessionTimeoutWarnedAt = 0;

  constructor(
    private readonly users: UserService,
    private readonly userRoles: UserRoleService,
    private readonly customers: CustomerService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly attributes: AttributeService,
    private readonly lov: LovService,
    private readonly registrationRequests: RegistrationRequestService,
    private readonly audit: AuditService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(UserDevice)
    private readonly devices: Repository<UserDevice>,
    @InjectRepository(UserLoginHistory)
    private readonly loginHistory: Repository<UserLoginHistory>,
    // Brute-force protection (account + IP lock-out). Optional only so a test can build the service
    // without it; the running app always provides it (see AuthModule).
    @Optional()
    private readonly attempts?: LoginAttemptsService,
    // Lets a revocation drop the cached "this session is live" answer of the sessions it ends (JwtStrategy keeps one
    // for a few seconds). Optional only so a test can build the service without it; without it that cache just expires.
    @Optional()
    private readonly sessions?: SessionLivenessService,
  ) {}

  /** Tries the staff User table first (the existing, larger population), then falls back to
   *  Customer — the two id/email spaces are fully independent, so this is a strict either/or, never
   *  a merge. Logs only the outcome and which table matched (never the password/hash) — enough to
   *  tell "no such account", "wrong password", and "which session type" apart from the server logs
   *  without ever exposing credentials. */
  async login(dto: LoginDto, deviceCtx?: DeviceContext): Promise<TokenResponseDto> {
    const clientIp = deviceCtx?.ipAddress;
    // Refused with 429 BEFORE any credential is checked while this account or this IP is locked from
    // repeated failures — so a correct guess during the lock-out is not even confirmed.
    await this.attempts?.assertAllowed(dto.email, clientIp);

    const user = await this.users.findByEmailWithPasswordHash(dto.email);
    if (user) {
      // Password is verified BEFORE the account-status check below, deliberately — this is what
      // lets the status check return a specific, account-status message without ever exposing
      // "this account exists" to someone who merely guessed the email and got the password wrong.
      // A wrong password always gets the same generic 'Invalid credentials' regardless of whether
      // the account is active, inactive, or has no password hash at all (bcrypt.compare against
      // undefined/'' never throws, it just returns false) — only once the password is CONFIRMED
      // correct does the account's actual status get to shape the response.
      const valid = !!user.passwordHash && (await bcrypt.compare(dto.password, user.passwordHash));
      if (!valid) {
        this.logger.warn(`Staff login rejected for ${maskEmail(dto.email)} — password mismatch or no password set`);
        await this.attempts?.recordFailure(dto.email, clientIp);
        throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
      }

      if (!user.active) {
        this.logger.warn(`Staff login rejected for ${maskEmail(dto.email)} — correct password, account inactive (userId=${user.id})`);
        // 403, not 401 — the credentials were verified correct above; this is the "authenticated
        // identity, refused standing" case, not "who are you" (that's what 401 means here and
        // everywhere else in this file). refresh()'s own '!user.active' check still throws 401
        // ('Account is deactivated') — an existing, narrower inconsistency this fix deliberately
        // does not touch (out of scope: refresh() re-validates an EXISTING session/token, a
        // different enough situation that changing it was not requested).
        throw new ForbiddenException(ERROR_MESSAGES.ACCOUNT_INACTIVE_CONTACT_ADMIN);
      }

      // RBAC-source-of-truth role lookup goes through user_roles, not the legacy users.role_id
      // column still present on `user` — see UserRole entity's own doc comment on this migration.
      const primaryRole = await this.userRoles.getPrimaryRole(user.id);
      if (!primaryRole) {
        this.logger.warn(`Staff login rejected for ${maskEmail(dto.email)} — no role assigned (userId=${user.id})`);
        await this.attempts?.recordFailure(dto.email, clientIp);
        throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
      }

      await this.attempts?.recordSuccess(dto.email);
      await this.users.updateLastLogin(user.id);
      await this.insertLoginHistory(PRINCIPAL_TYPE.STAFF, user.id, deviceCtx);
      this.logger.log(`Staff login succeeded for ${maskEmail(dto.email)} (userId=${user.id})`);

      const tokens = await this.issueTokenPair(
        { sub: user.id, email: user.email, roleId: primaryRole.roleId, roleName: primaryRole.roleName, type: PRINCIPAL_TYPE.STAFF },
        undefined,
        deviceCtx,
        dto.rememberMe === true,
      );

      // A real, usable session either way — this flag only tells the frontend to route the user
      // through the mandatory change-password screen before the normal app shell, it never narrows
      // what the access token itself can do server-side (every other endpoint stays unaffected).
      return user.mustChangePassword ? { ...tokens, mustChangePassword: true } : tokens;
    }

    const customer = await this.customers.findByEmailForLogin(dto.email);
    // Same password-before-status ordering as the staff branch above, for the same reason — the
    // status check below must never run (and never shape the response) until the password is
    // confirmed correct, so an attacker who doesn't know the password can't use the response to
    // learn anything about whether the account exists or what state it's in.
    const customerValid = !!customer?.passwordHash && (await bcrypt.compare(dto.password, customer.passwordHash));
    if (!customerValid) {
      this.logger.warn(`Customer login rejected for ${maskEmail(dto.email)} — password mismatch, no account, or no password set`);
      // Counted the same whether or not the email exists, so the lock-out never reveals which emails are real.
      await this.attempts?.recordFailure(dto.email, clientIp);
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }
    await this.attempts?.recordSuccess(dto.email);

    // `accountStatus === ACTIVE` is NOT required to log in — a Customer who has completed account
    // setup (set a password) but is still awaiting a required Security Deposit stays `INACTIVE`
    // until RegistrationRequestService.verifyDeposit() flips it (see Customer.entity's own doc
    // comment and CustomerService.activate()'s own doc comment on this exact split); that Customer
    // must still be able to log in to reach the restricted registration-completion flow —
    // `portalAccess`/CustomerAccessGuard is what restricts what they can do once logged in, not
    // login itself. `OVERDUE` is the one accountStatus value that DOES still block login outright
    // (an existing, separate billing-suspension concept, unrelated to this activation flow — see
    // CustomerAccountStatus's own doc comment).
    if (customer!.accountStatus === CustomerAccountStatus.OVERDUE) {
      this.logger.warn(`Customer login rejected for ${maskEmail(dto.email)} — correct password, account overdue (customerId=${customer!.id})`);
      // 403 — same reasoning as the staff branch above: credentials already verified correct,
      // account status is what's refusing access now.
      throw new ForbiddenException(ERROR_MESSAGES.ACCOUNT_INACTIVE_CONTACT_ADMIN);
    }

    await this.insertLoginHistory(PRINCIPAL_TYPE.CUSTOMER, customer!.id, deviceCtx);
    this.logger.log(`Customer login succeeded for ${maskEmail(dto.email)} (customerId=${customer!.id})`);

    return this.issueTokenPair(
      { sub: customer!.id, email: customer!.email!, type: PRINCIPAL_TYPE.CUSTOMER },
      undefined,
      deviceCtx,
      dto.rememberMe === true,
    );
  }

  /** Re-verifies against the SAME table the original session was issued from — `stored.principalType`
   *  (never the caller's own assumption) decides whether this refresh token's `userId` is looked up
   *  in `users` or `customers`, and the re-issued token carries that same type forward. This is what
   *  makes "refresh preserves the correct identity type" true: before principalType existed, this
   *  method always called `this.users.findOne(stored.userId)` regardless of which table actually
   *  issued the token — a customer's refresh would either 404 or, worse, silently resolve an
   *  unrelated staff User row that happened to share the same numeric id, then hand back a
   *  fabricated STAFF-typed token for a customer session.
   *
   *  The session's "Remember me" flag is read from the STORED token (`stored.rememberMe`), never from the request, and
   *  handed on to the new token — so a remembered session stays remembered (same persistent cookie, same longer
   *  lifetime) and an ordinary one can never be upgraded by a refresh. */
  async refresh(rawToken: string, deviceCtx?: DeviceContext): Promise<TokenResponseDto> {
    const hash = this.hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash: hash } });

    if (!stored) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_REFRESH_TOKEN);
    }

    if (stored.revokedAt) {
      // A replayed (already rotated or revoked) token: the whole session is ended — tokens, device and history row.
      await this.endSessions(stored.principalType, stored.userId, { only: [stored.family] });
      throw new UnauthorizedException(ERROR_MESSAGES.REFRESH_TOKEN_ALREADY_USED);
    }

    if (stored.expiresAt < new Date()) {
      // A session whose refresh token ran out is over: it is revoked like any other ended session (its device and
      // login-history row are closed with it) instead of staying listed as live until something else tidies it. The
      // refresh is refused all the same.
      await this.endSessions(stored.principalType, stored.userId, { only: [stored.family] });
      throw new UnauthorizedException('Refresh token expired');
    }

    if (deviceCtx?.deviceId && stored.deviceId && stored.deviceId !== deviceCtx.deviceId) {
      throw new UnauthorizedException('Device mismatch');
    }

    // A session keeps the device it was issued for, so a refresh never silently detaches it (a missing header changes
    // nothing). The header is only a label: it fills in a session that has none (issued before devices were tracked),
    // and it can never revive a device that was signed out — a live session on a signed-out device is ended instead.
    const deviceId = stored.deviceId ?? deviceCtx?.deviceId;
    if (deviceId && (await this.isDeviceSignedOut(stored.principalType, stored.userId, deviceId))) {
      await this.endSessions(stored.principalType, stored.userId, { only: [stored.family] });
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_REFRESH_TOKEN);
    }

    // ATOMIC rotation: the token is revoked with a conditional UPDATE (`revoked_at IS NULL`) and only the
    // request that actually flipped the row may continue. The read above and a plain update would let
    // two parallel refreshes both see "not revoked" and both mint a new pair from one token. The loser
    // is treated exactly like a replayed token — its whole family is revoked.
    const rotation = await this.refreshTokens
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('id = :id AND revoked_at IS NULL', { id: stored.id })
      .execute();
    if (!rotation.affected) {
      await this.endSessions(stored.principalType, stored.userId, { only: [stored.family] });
      throw new UnauthorizedException(ERROR_MESSAGES.REFRESH_TOKEN_ALREADY_USED);
    }

    const effectiveCtx: DeviceContext = { ...deviceCtx, deviceId };

    if (stored.principalType === PRINCIPAL_TYPE.CUSTOMER) {
      let customer;
      try {
        customer = await this.customers.findOne(stored.userId);
      } catch {
        throw new UnauthorizedException(ERROR_MESSAGES.CUSTOMER_NOT_FOUND);
      }
      // Same relaxed rule as login() above — a restricted (deposit-pending) Customer's refresh
      // token must keep working, only OVERDUE (a separate, existing billing-suspension concept)
      // actually revokes access here.
      if (customer.accountStatus === CustomerAccountStatus.OVERDUE) {
        throw new UnauthorizedException(ERROR_MESSAGES.ACCOUNT_NOT_ACTIVE);
      }
      return this.issueTokenPair(
        { sub: customer.id, email: customer.email!, type: PRINCIPAL_TYPE.CUSTOMER },
        stored.family,
        effectiveCtx,
        stored.rememberMe === true,
      );
    }

    let user;
    try {
      user = await this.users.findOne(stored.userId);
    } catch {
      throw new UnauthorizedException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    if (!user.active) {
      throw new UnauthorizedException(ERROR_MESSAGES.ACCOUNT_DEACTIVATED);
    }

    const primaryRole = await this.userRoles.getPrimaryRole(user.id);
    if (!primaryRole) {
      throw new UnauthorizedException(ERROR_MESSAGES.NO_ROLE_ASSIGNED);
    }

    const tokens = await this.issueTokenPair(
      { sub: user.id, email: user.email, roleId: primaryRole.roleId, roleName: primaryRole.roleName, type: PRINCIPAL_TYPE.STAFF },
      stored.family,
      effectiveCtx,
      stored.rememberMe === true,
    );
    // The web app restores its session from the refresh cookie on every page load, so it learns here — not
    // only at sign-in — that a password change is still required.
    return user.mustChangePassword ? { ...tokens, mustChangePassword: true } : tokens;
  }

  /** Signs out the session the presented refresh token belongs to: the whole token family (so a rotated copy of the
   *  cookie cannot keep it alive), its device and its login-history row. An unknown token is a no-op — signing out
   *  twice is not an error. */
  async logout(rawToken: string): Promise<void> {
    const stored = await this.refreshTokens.findOne({ where: { tokenHash: this.hashToken(rawToken) } });
    if (!stored) return;
    await this.endSessions(stored.principalType, stored.userId, { only: [stored.family] }, { action: SESSION_AUDIT_ACTION.LOGOUT });
  }

  /** "Sign out" on one row of Active Sessions: ends every session that has a refresh token on that device — whole
   *  token families, so a token that lost its device label cannot survive — and the device with them. */
  async logoutDevice(principal: AuthPrincipal, deviceId: string): Promise<void> {
    const principalType = this.principalTypeOf(principal);
    const device = await this.devices.findOne({ where: { principalType, deviceId, userId: principal.sub } });
    if (!device) throw new NotFoundException('Device not found');

    const families = await this.familiesOnDevice(principalType, principal.sub, deviceId);
    await this.endSessions(
      principalType,
      principal.sub,
      { only: families },
      { action: SESSION_AUDIT_ACTION.REVOKE_DEVICE, newValue: { deviceId }, always: true },
    );
  }

  /**
   * Ends every session of the principal except `exceptFamilies` (the session making the request, when it must
   * survive). No exception revokes everything: the admin actions below, which audit their own action, and the
   * building block of the self-service methods that follow. Sessions without a device are revoked like any other.
   */
  async logoutAll(principalType: PrincipalType, userId: number, exceptFamilies: readonly string[] = []): Promise<void> {
    await this.endSessions(principalType, userId, { except: exceptFamilies });
  }

  /** Self-service "Sign out everywhere": every session of the principal, including the one making the request. */
  async logoutEverywhere(principal: AuthPrincipal): Promise<void> {
    await this.endSessions(this.principalTypeOf(principal), principal.sub, {}, { action: SESSION_AUDIT_ACTION.LOGOUT_ALL });
  }

  /**
   * Self-service "Sign out of every other session" (also what a password change does): every session except the one
   * making the request, which is identified by the access token's own `sid` — never by a client-supplied device id, so
   * claiming another device's id cannot keep a session alive. Only a token issued before `sid` existed falls back to
   * the (validated) device label.
   */
  async logoutOtherSessions(principal: AuthPrincipal, legacyDeviceId?: string, reason?: string): Promise<void> {
    const principalType = this.principalTypeOf(principal);
    const keep = await this.sessionsToKeep(principal, principalType, legacyDeviceId);
    await this.endSessions(
      principalType,
      principal.sub,
      { except: keep },
      { action: SESSION_AUDIT_ACTION.REVOKE_OTHER_SESSIONS, newValue: reason ? { reason } : undefined },
    );
  }

  /**
   * Same either/or branch as login() — staff (User) vs. Customer, never both. Requires the
   * CURRENT password (bcrypt-compared against the existing hash, same convention as login) before
   * writing a new one, so a hijacked/unattended active session can't silently lock the real owner
   * out just by holding a valid access token. On success, every OTHER device is revoked
   * (logoutOtherSessions, by session id) — the caller's own current session survives so they aren't
   * immediately logged out by the very action they just took.
   */
  async changePassword(
    principal: AuthPrincipal,
    dto: { currentPassword: string; newPassword: string },
    deviceCtx?: DeviceContext,
  ): Promise<void> {
    const principalType: PrincipalType = principal.type === PRINCIPAL_TYPE.CUSTOMER ? PRINCIPAL_TYPE.CUSTOMER : PRINCIPAL_TYPE.STAFF;

    const account = await this.loadPasswordChangeAccount(principalType, principal);
    const clientIp = deviceCtx?.ipAddress;

    // The current password is what separates the account's owner from whoever holds an unattended or stolen session, so
    // guessing it meets the SAME lock-out as signing in (LoginAttemptsService: same account + IP counters, same 429): a
    // locked account / IP is refused BEFORE the password is looked at — a correct guess during the lock-out is not even
    // confirmed — every wrong attempt is counted (and audited), and a correct one clears the account's counter.
    await this.attempts?.assertAllowed(account.email, clientIp);
    const valid = await bcrypt.compare(dto.currentPassword, account.passwordHash);
    if (!valid) {
      await this.recordCurrentPasswordFailure(principalType, principal.sub, account.email, deviceCtx);
      throw new UnauthorizedException(ERROR_MESSAGES.CURRENT_PASSWORD_INCORRECT);
    }
    await this.attempts?.recordSuccess(account.email);

    await this.assertPasswordIsNew(dto.newPassword, account.passwordHash);
    const newHash = await bcrypt.hash(dto.newPassword, PASSWORD_HASH_ROUNDS);
    if (principalType === PRINCIPAL_TYPE.STAFF) {
      await this.users.setPasswordHash(principal.sub, newHash);
      this.logger.log(`Password changed for staff userId=${principal.sub}`);
    } else {
      await this.customers.setPasswordHash(principal.sub, newHash);
      this.logger.log(`Password changed for customerId=${principal.sub}`);
    }
    // Audited as soon as the change is made — before the sessions are revoked below, so the credential change is on record
    // even if the revocation then fails. Only what the change did, never the password or its hash.
    await this.recordPasswordAudit(principalType, principal.sub, AUDIT_CREDENTIAL_ACTION.CHANGE_PASSWORD, {
      forcedChangeCleared: account.mustChangePassword,
      deviceId: deviceCtx?.deviceId ?? null,
      ipAddress: clientIp ?? null,
    });

    await this.logoutOtherSessions(principal, deviceCtx?.deviceId, SESSION_REVOKE_REASON.PASSWORD_CHANGE);
  }

  // Cryptographically random (crypto.getRandomValues-equivalent via Node's crypto.randomBytes,
  // never Math.random) — AWS's own "Autogenerated password" option for admin-triggered resets.
  // Mirrors the Create User wizard's own frontend generator (components/users/UserWizard.tsx's
  // generateSecurePassword) but server-side, since this path's password never touches the client
  // until it's returned in the response.
  private generateSecurePassword(length = 20): string {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
    // randomInt draws uniformly (no modulo bias), and a candidate is only returned once it satisfies the
    // same password policy a human-chosen password must — so a generated password can never be one the
    // system would reject.
    for (;;) {
      const candidate = Array.from({ length }, () => charset[randomInt(0, charset.length)]).join('');
      if (isStrongPassword(candidate)) return candidate;
    }
  }

  /** A password change must actually change the password. */
  private async assertPasswordIsNew(newPassword: string, currentHash: string): Promise<void> {
    if (await bcrypt.compare(newPassword, currentHash)) {
      throw new BadRequestException('The new password must be different from your current password.');
    }
  }

  /** The signed-in account's own credential row for a password change: the e-mail the sign-in lock-out is keyed by (the
   *  account's current one, not the token's), the stored hash, and whether a forced change is still pending. An account
   *  with no stored password (an administrator disabled its sign-in access) has nothing to verify against. */
  private async loadPasswordChangeAccount(
    principalType: PrincipalType,
    principal: AuthPrincipal,
  ): Promise<{ email: string; passwordHash: string; mustChangePassword: boolean }> {
    if (principalType === PRINCIPAL_TYPE.STAFF) {
      const user = await this.users.findByIdWithPasswordHash(principal.sub);
      if (!user?.passwordHash) {
        throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
      }
      return { email: user.email, passwordHash: user.passwordHash, mustChangePassword: user.mustChangePassword === true };
    }
    const customer = await this.customers.findByIdWithPasswordHash(principal.sub);
    if (!customer?.passwordHash) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }
    return { email: customer.email ?? principal.email, passwordHash: customer.passwordHash, mustChangePassword: false };
  }

  /** A wrong current password: logged, counted against the account and the client IP exactly like a failed sign-in (so a
   *  stolen or unattended session cannot guess it past the sign-in lock-out) and audited, `locked` saying whether this very
   *  failure tripped the lock-out. Never records the password that was tried. */
  private async recordCurrentPasswordFailure(
    principalType: PrincipalType,
    principalId: number,
    email: string,
    deviceCtx?: DeviceContext,
  ): Promise<void> {
    this.logger.warn(
      principalType === PRINCIPAL_TYPE.STAFF
        ? `Password change rejected for staff userId=${principalId} — current password mismatch`
        : `Password change rejected for customerId=${principalId} — current password mismatch`,
    );
    await this.attempts?.recordFailure(email, deviceCtx?.ipAddress);
    const lock = await this.attempts?.lockState(email, deviceCtx?.ipAddress);
    await this.recordPasswordAudit(principalType, principalId, AUDIT_CREDENTIAL_ACTION.CHANGE_PASSWORD_FAILED, {
      locked: lock?.locked === true,
      deviceId: deviceCtx?.deviceId ?? null,
      ipAddress: deviceCtx?.ipAddress ?? null,
    });
  }

  /** Writes one audit row for the SELF-SERVICE password flow, on the account itself (users for staff, customers for a
   *  portal account). Best-effort on purpose: the event it describes has already happened — a committed password change
   *  that cannot be rolled back, or a refusal already counted — so a failing audit write must neither turn it into an error
   *  response nor keep the sessions from being revoked; the failure is logged for the operator instead. `details` must
   *  never carry a password or a hash. */
  private async recordPasswordAudit(
    principalType: PrincipalType,
    principalId: number,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        moduleName: principalType === PRINCIPAL_TYPE.STAFF ? AUDIT_MODULE.USERS : AUDIT_MODULE.CUSTOMERS,
        entityId: principalId,
        action,
        newValue: details,
        // A customer id is not a user id (two independent id spaces): only a staff account is recorded as the actor.
        performedBy: principalType === PRINCIPAL_TYPE.STAFF ? principalId : undefined,
      });
    } catch (err) {
      this.logger.error(
        `Audit entry ${action} for ${principalType} id=${principalId} could not be written: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Admin-triggered "Manage sign-in access -> Reset password" for ANOTHER staff user. Deliberately
   * does NOT call UserService.setPasswordHash — that method always
   * forces mustChangePassword back to false, which is the opposite of what this action needs to be
   * able to do (the admin can choose to force it true). Uses UserService.adminSetPasswordHash
   * instead, a sibling method with no such hidden behavior. Optionally also revokes every active
   * session for the target user (logoutAll) — unlike changePassword's own self-service call to
   * logoutAll, there is no "caller's own current session" to exempt here, since the caller (the
   * admin) and the target are different people; passing no exceptDeviceId revokes everything.
   */
  async adminResetPassword(targetUserId: number, dto: AdminResetPasswordDto, actor: Actor): Promise<AdminResetPasswordResponseDto> {
    const targetUser = await this.users.findOne(targetUserId);
    this.assertNotSelf(actor, targetUserId, 'Use "Change password" to change your own password.');
    // RESET_USER_PASSWORD is delegable, and a reset hands the actor a working login for the target — so a
    // SUPER_ADMIN account can only ever be reset by another SUPER_ADMIN.
    await this.userRoles.assertActorMayModifyUser(actor, targetUserId);

    const generatedPassword = dto.newPassword ? undefined : this.generateSecurePassword();
    const newPassword = dto.newPassword ?? generatedPassword!;
    // The admin knows this password, so by default the user must replace it at their next sign-in.
    const mustChangePassword = dto.mustChangePassword ?? true;

    const newHash = await bcrypt.hash(newPassword, PASSWORD_HASH_ROUNDS);
    await this.users.adminSetPasswordHash(targetUserId, newHash, mustChangePassword);

    if (dto.revokeSessions) {
      await this.logoutAll(PRINCIPAL_TYPE.STAFF, targetUserId);
    }

    this.logger.log(`Password reset by actorId=${actorUserId(actor) ?? 'unknown'} for staff userId=${targetUserId}`);
    await this.audit.record({
      moduleName: AUDIT_MODULE.USERS,
      entityId: targetUserId,
      action: 'ADMIN_RESET_PASSWORD',
      // Never the password/hash itself — same norm as every other audit call in this codebase (e.g.
      // CustomerService.create never logs passwordHash). Only non-sensitive metadata about what
      // changed.
      oldValue: { email: targetUser.email },
      newValue: { mustChangePassword, sessionsRevoked: !!dto.revokeSessions, passwordWasAutogenerated: !dto.newPassword },
      performedBy: actorUserId(actor),
    });

    return {
      userId: targetUserId,
      generatedPassword,
      mustChangePassword,
      sessionsRevoked: !!dto.revokeSessions,
    };
  }

  /**
   * Admin-triggered "Manage sign-in access -> Disable sign-in access" for ANOTHER staff user —
   * invalidates the CURRENT password so the user can no longer sign in, WITHOUT touching the
   * account's `active` field (that's ordinary account deactivation, a separate, already-existing
   * concept via UpdateUserDto.active). login()'s own bcrypt.compare against a null hash already
   * returns false safely (see its own comment) — no change needed there.
   */
  async disableSigninAccess(targetUserId: number, revokeSessions: boolean, actor: Actor): Promise<{ sessionsRevoked: boolean }> {
    const targetUser = await this.users.findOne(targetUserId);
    this.assertNotSelf(actor, targetUserId, 'You cannot disable your own sign-in access.');
    // A SUPER_ADMIN's sign-in can only be disabled by another SUPER_ADMIN — who, being signed in, is
    // still an active administrator, so this can never remove the last one.
    await this.userRoles.assertActorMayModifyUser(actor, targetUserId);
    await this.users.clearPasswordHash(targetUserId);

    if (revokeSessions) {
      await this.logoutAll(PRINCIPAL_TYPE.STAFF, targetUserId);
    }

    this.logger.log(`Sign-in access disabled by actorId=${actorUserId(actor) ?? 'unknown'} for staff userId=${targetUserId}`);
    await this.audit.record({
      moduleName: AUDIT_MODULE.USERS,
      entityId: targetUserId,
      action: 'DISABLE_SIGNIN_ACCESS',
      oldValue: { email: targetUser.email },
      newValue: { signinAccessDisabled: true, sessionsRevoked: revokeSessions },
      performedBy: actorUserId(actor),
    });

    return { sessionsRevoked: revokeSessions };
  }

  /**
   * Admin-triggered "Revoke active sign-in sessions" for ANOTHER staff user, as a standalone action
   * (also offered as a checkbox inside adminResetPassword/disableSigninAccess above). Thin wrapper
   * around the existing, unchanged logoutAll — the only addition here is the audit entry, since
   * logoutAll itself is shared with the self-service changePassword path, which doesn't audit-log
   * today either; adding audit logging inside logoutAll itself would change that shared path's
   * behavior too, which this deliberately avoids.
   */
  async adminRevokeSessions(targetUserId: number, actor: Actor): Promise<void> {
    const targetUser = await this.users.findOne(targetUserId);
    this.assertNotSelf(actor, targetUserId, 'Use "Log out everywhere" to end your own sessions.');
    await this.userRoles.assertActorMayModifyUser(actor, targetUserId);
    await this.logoutAll(PRINCIPAL_TYPE.STAFF, targetUserId);

    this.logger.log(`Sessions revoked by actorId=${actorUserId(actor) ?? 'unknown'} for staff userId=${targetUserId}`);
    await this.audit.record({
      moduleName: AUDIT_MODULE.USERS,
      entityId: targetUserId,
      action: 'REVOKE_SESSIONS',
      oldValue: { email: targetUser.email },
      newValue: { sessionsRevoked: true },
      performedBy: actorUserId(actor),
    });
  }

  /** The admin credential actions are for OTHER people's accounts; your own go through the self-service
   *  flows, which require your current password / your own session. */
  private assertNotSelf(actor: Actor, targetUserId: number, message: string): void {
    if (actor.kind === ACTOR_KIND.USER && actor.id === targetUserId) {
      throw new ForbiddenException(message);
    }
  }

  async getSigninAccessStatus(targetUserId: number): Promise<SigninAccessStatusResponseDto> {
    const status = await this.users.getSigninAccessStatus(targetUserId);
    return {
      signinAccessEnabled: status.signinAccessEnabled,
      passwordUpdatedAt: status.passwordUpdatedAt?.toISOString() ?? null,
    };
  }

  /**
   * The principal's LIVE sessions, one row per device: the device is active and still has an unrevoked, unexpired
   * refresh token, so a signed-out, revoked, abandoned or expired session is not listed. `isCurrentDevice` is the device
   * of the session that made the request, taken from the access token's `sid` — never from a client header. Only a token
   * issued before `sid` existed falls back to the (validated) X-Device-Id label.
   */
  async getDevices(principal: AuthPrincipal, legacyDeviceId?: string): Promise<UserDeviceDto[]> {
    const principalType = this.principalTypeOf(principal);
    const now = new Date();
    const [list, live] = await Promise.all([
      this.devices.find({
        where: { principalType, userId: principal.sub, isActive: true },
        order: { lastActivityAt: SORT_ORDER.DESC },
      }),
      this.findLiveSessions(principalType, principal.sub, now),
    ]);

    const liveDeviceIds = new Set(live.map((session) => session.deviceId));
    const currentDeviceIds = new Set(live.filter((session) => session.family === principal.sid).map((session) => session.deviceId));

    return list
      .filter((d) => liveDeviceIds.has(d.deviceId) && (!d.expiresAt || d.expiresAt > now))
      .map((d) => ({
        id: d.id,
        deviceId: d.deviceId,
        deviceName: d.deviceName ?? null,
        deviceType: d.deviceType ?? null,
        browser: d.browser ?? null,
        browserVersion: d.browserVersion ?? null,
        operatingSystem: d.operatingSystem ?? null,
        osVersion: d.osVersion ?? null,
        ipAddress: d.ipAddress ?? null,
        lastLoginAt: d.lastLoginAt?.toISOString() ?? null,
        lastActivityAt: d.lastActivityAt?.toISOString() ?? null,
        expiresAt: d.expiresAt?.toISOString() ?? null,
        rememberMe: Boolean(d.rememberMe),
        isTrusted: d.isTrusted,
        isCurrentDevice: principal.sid ? currentDeviceIds.has(d.deviceId) : !!legacyDeviceId && d.deviceId === legacyDeviceId,
      }));
  }

  /** The principal's most recent sign-ins. `status` is computed here, never stored: a row that was never closed is
   *  'active' only while a live session still stands behind it, otherwise it lapsed ('expired'). */
  async getLoginHistory(principalType: PrincipalType, userId: number, limit = DEFAULT_LIMIT): Promise<LoginHistoryDto[]> {
    const [records, live] = await Promise.all([
      this.loginHistory.find({
        where: { principalType, userId },
        order: { loginAt: SORT_ORDER.DESC },
        take: limit,
      }),
      this.findLiveSessions(principalType, userId),
    ]);

    // Newest first: a device's live session vouches for ONE open row (its newest), and sessions without a device for as
    // many open rows as there are such sessions.
    const unclaimedDevices = new Set(live.map((session) => session.deviceId).filter((deviceId): deviceId is string => !!deviceId));
    let unclaimedDevicelessSessions = live.filter((session) => !session.deviceId).length;
    const claimLiveSession = (deviceId?: string | null): boolean => {
      if (deviceId) return unclaimedDevices.delete(deviceId);
      if (unclaimedDevicelessSessions === 0) return false;
      unclaimedDevicelessSessions -= 1;
      return true;
    };

    return records.map((r) => ({
      id: r.id,
      deviceId: r.deviceId ?? null,
      ipAddress: r.ipAddress ?? null,
      browser: r.browser ?? null,
      platform: r.platform ?? null,
      loginAt: r.loginAt.toISOString(),
      logoutAt: r.logoutAt?.toISOString() ?? null,
      status: r.logoutAt
        ? LOGIN_HISTORY_STATUS.SIGNED_OUT
        : claimLiveSession(r.deviceId)
          ? LOGIN_HISTORY_STATUS.ACTIVE
          : LOGIN_HISTORY_STATUS.EXPIRED,
    }));
  }

  /**
   * Issues an access token and a refresh token. `family` is the session being continued (a refresh); left out, this is
   * a new sign-in and a new session — a fresh UUID — starts. The session id is signed into the access token as `sid`,
   * which is what JwtStrategy checks on every request.
   *
   * `rememberMe` is the session's "Remember me" choice: the sign-in's own or — on a refresh — the flag the session
   * already carries (never the client's say-so), so a remembered session stays remembered. It decides ONLY the refresh
   * token's lifetime (refreshLifetimeFor) and, in the controller, whether the cookie is persistent; the access token is
   * the same either way.
   */
  async issueTokenPair(
    payload: AuthPrincipal,
    family?: string,
    deviceCtx?: DeviceContext,
    rememberMe = false,
  ): Promise<TokenResponseDto> {
    const isSignIn = family === undefined;
    const sid = family ?? randomUUID();
    const accessTokenExpiresIn = await this.resolveAccessTokenExpiry();
    const accessToken = this.jwt.sign({ ...payload, sid }, { expiresIn: accessTokenExpiresIn });

    const principalType: PrincipalType = payload.type === PRINCIPAL_TYPE.CUSTOMER ? PRINCIPAL_TYPE.CUSTOMER : PRINCIPAL_TYPE.STAFF;
    const rawRefreshToken = randomBytes(SECURE_TOKEN_BYTES).toString(HEX_ENCODING);
    const tokenHash = this.hashToken(rawRefreshToken);
    const refreshExpiresIn = this.refreshLifetimeFor(rememberMe);
    const expiresAt = this.parseExpiry(refreshExpiresIn);

    await this.refreshTokens.save(
      this.refreshTokens.create({
        tokenHash,
        principalType,
        userId: payload.sub,
        family: sid,
        deviceId: deviceCtx?.deviceId,
        expiresAt,
        rememberMe,
      }),
    );

    if (deviceCtx?.deviceId) {
      await this.upsertDevice(principalType, payload.sub, deviceCtx, tokenHash, expiresAt, isSignIn, rememberMe);
    }

    return {
      accessToken,
      tokenType: TOKEN_TYPE_BEARER,
      expiresIn: accessTokenExpiresIn,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresIn: refreshExpiresIn,
      rememberMe,
    };
  }

  getSsoAuthorizationUrl(state?: string): string {
    const url = new URL(this.config.getOrThrow<string>('SSO_AUTHORIZATION_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.getOrThrow<string>('SSO_CLIENT_ID'));
    url.searchParams.set('redirect_uri', this.config.getOrThrow<string>('SSO_CALLBACK_URL'));
    if (state) url.searchParams.set('state', state);
    return url.toString();
  }

  /**
   * Everything the frontend needs to render the authenticated app shell, composed in one call.
   * `sessionConfig`/`languages` are shared by both session kinds; `profile` (staff, incl. RBAC
   * permission tree) vs `customerProfile` (customer, no role/permissions — a Customer has no Role
   * row) are mutually exclusive, picked by `principal.type` — never both fetched, so a customer
   * session never touches UserService and can never be treated as a staff User (see JwtStrategy's
   * own doc comment on why the two id spaces must never be conflated). Reuses the existing
   * UserService/CustomerService/AttributeService/LovService methods; no new data source, just one
   * aggregation point per session kind.
   */
  async bootstrap(principal: AuthPrincipal): Promise<BootstrapResponseDto> {
    const [profileResult, sessionTimeoutMinutes, languages, depositResult] = await Promise.all([
      principal.type === PRINCIPAL_TYPE.CUSTOMER
        ? this.customers.findOne(principal.sub)
        : this.users.getProfile(principal.sub),
      this.getSessionTimeoutMinutes(),
      this.lov.findActiveLanguages(),
      // Only meaningful for a customer session — fetched unconditionally alongside the rest so this
      // stays one Promise.all rather than a second network round-trip, and simply unused for staff.
      // Only `depositStatus` is actually used below — `customer.accountStatus` (fetched via
      // `profileResult` above) is the live accountStatus computePortalAccess needs, not this call's
      // own `accountStatus` field (same underlying column, no point reading it twice).
      principal.type === PRINCIPAL_TYPE.CUSTOMER ? this.registrationRequests.getMyDepositStatus(principal.sub) : null,
    ]);

    const languagesMapped = languages.map((l) => ({
      code: l.code,
      label: l.label,
      direction: l.direction ?? null,
      localeCode: l.localeCode ?? null,
    }));

    if (principal.type === PRINCIPAL_TYPE.CUSTOMER) {
      const customer = profileResult as Awaited<ReturnType<CustomerService['findOne']>>;
      return {
        type: PRINCIPAL_TYPE.CUSTOMER,
        customerProfile: {
          id: customer.id,
          businessCode: customer.businessCode,
          fullName: customer.fullName,
          email: customer.email ?? principal.email,
          mobile: customer.mobile,
          accountStatus: customer.accountStatus,
        },
        // The SAME rule CustomerAccessGuard enforces server-side for every other route — surfaced
        // here so the frontend can render the right UX (redirect to the registration/deposit flow,
        // hide normal Portal nav) WITHOUT re-deriving the business rule itself. Deposit Verified
        // alone is NOT enough (see computePortalAccess's own doc comment) — accountStatus must have
        // actually reached ACTIVE too, which is why `customer.accountStatus` (the live column, just
        // fetched above) is passed alongside `depositResult.depositStatus` rather than assuming the
        // two can never have drifted. This is UX guidance only, never the actual security boundary —
        // CustomerAccessGuard's own live re-check on every request is what a client can't bypass by
        // ignoring this field.
        portalAccess: computePortalAccess(depositResult?.depositStatus ?? null, customer.accountStatus),
        sessionConfig: { idleTimeoutMinutes: sessionTimeoutMinutes },
        languages: languagesMapped,
      };
    }

    return {
      type: PRINCIPAL_TYPE.STAFF,
      profile: profileResult as Awaited<ReturnType<UserService['getProfile']>>,
      sessionConfig: { idleTimeoutMinutes: sessionTimeoutMinutes },
      languages: languagesMapped,
    };
  }

  /** GET /auth/session-config. The same resolver as the bootstrap and the access-token lifetime, so the three agree. */
  async getSessionConfig(): Promise<SessionConfigDto> {
    return { idleTimeoutMinutes: await this.getSessionTimeoutMinutes() };
  }

  /**
   * Minutes of inactivity after which the web app signs the user out, which is also the lifetime of an access token
   * (one setting on purpose; separating the two is a product decision). ONE resolver — token issuing, the bootstrap and
   * GET /auth/session-config all use it — with ONE fallback chain:
   *   1. the SESSION_TIMEOUT_MINUTES attribute (owned by Attributes);
   *   2. the SESSION_TIMEOUT_MINUTES environment variable (the value the attribute is first seeded from);
   *   3. DEFAULT_SESSION_TIMEOUT_MINUTES.
   * A value is usable only as a positive whole number of minutes. A missing or malformed attribute is logged (at most
   * every SESSION_TIMEOUT_WARNING_INTERVAL_MS) and never fails the request. JWT_EXPIRES_IN is not consulted: it is only
   * the JwtModule's default sign option, which every sign() call here overrides.
   */
  async getSessionTimeoutMinutes(): Promise<number> {
    const attributeValue = await this.attributes.getValueByKey(ATTRIBUTE_KEY.SESSION_TIMEOUT_MINUTES);
    const fromAttribute = toWholeMinutes(attributeValue);
    if (fromAttribute !== null) return fromAttribute;

    const fromEnvironment = toWholeMinutes(this.config.get<string | number>(ENV_KEY.SESSION_TIMEOUT_MINUTES));
    const minutes = fromEnvironment ?? DEFAULT_SESSION_TIMEOUT_MINUTES;
    this.warnSessionTimeoutFallback(
      attributeValue,
      minutes,
      fromEnvironment !== null ? 'the SESSION_TIMEOUT_MINUTES environment variable' : 'the built-in default',
    );
    return minutes;
  }

  private warnSessionTimeoutFallback(attributeValue: string | null, minutes: number, source: string): void {
    const now = Date.now();
    if (now - this.sessionTimeoutWarnedAt < SESSION_TIMEOUT_WARNING_INTERVAL_MS) return;
    this.sessionTimeoutWarnedAt = now;
    const problem = attributeValue === null ? 'is not configured' : `is not a positive whole number of minutes (${JSON.stringify(attributeValue)})`;
    this.logger.warn(`The SESSION_TIMEOUT_MINUTES attribute ${problem}; using ${minutes} minutes from ${source}. Set it in Attributes.`);
  }

  private async resolveAccessTokenExpiry(): Promise<string> {
    return `${await this.getSessionTimeoutMinutes()}m`;
  }

  private async insertLoginHistory(principalType: PrincipalType, userId: number, deviceCtx?: DeviceContext): Promise<void> {
    if (deviceCtx?.deviceId) {
      await this.loginHistory
        .createQueryBuilder()
        .update()
        .set({ logoutAt: new Date() })
        .where('user_id = :userId AND principal_type = :principalType AND device_id = :deviceId AND logout_at IS NULL', {
          userId,
          principalType,
          deviceId: deviceCtx.deviceId,
        })
        .execute();
    }

    const uaInfo = parseUserAgent(deviceCtx?.userAgent);
    await this.loginHistory.save(
      this.loginHistory.create({
        principalType,
        userId,
        deviceId: deviceCtx?.deviceId ?? null,
        ipAddress: deviceCtx?.ipAddress ?? null,
        browser: uaInfo.browser ?? null,
        platform: uaInfo.operatingSystem ?? null,
        // Stamped here, like every other session instant (logout_at, revoked_at, last_activity_at), not by the database
        // clock, so a database in another time zone cannot shift "Signed in" away from "Signed out".
        loginAt: new Date(),
      }),
    );
  }

  private principalTypeOf(principal: AuthPrincipal): PrincipalType {
    return principal.type === PRINCIPAL_TYPE.CUSTOMER ? PRINCIPAL_TYPE.CUSTOMER : PRINCIPAL_TYPE.STAFF;
  }

  /**
   * The ONE way a session is ended — sign-out, device revoke, sign-out-others, admin action, replayed refresh token. The
   * refresh tokens in `scope` are revoked, the devices and login-history rows that are left without a live session are
   * closed (revokeUserSessions) and, for a self-service action, the audit row is written — all in ONE transaction, so a
   * failure part-way leaves nothing half-done. The ended sessions' cached "live" answers are dropped afterwards, so
   * JwtStrategy refuses their access tokens from the next request on. Returns the sessions that were live.
   */
  private async endSessions(principalType: PrincipalType, userId: number, scope: SessionScope, audit?: SessionAudit): Promise<string[]> {
    const manager = this.refreshTokens.manager;
    const families = await findLiveFamilies(manager, principalType, userId, scope);

    await manager.transaction(async (tx) => {
      await revokeUserSessions(tx, principalType, userId, scope);
      if (audit && (audit.always || families.length > 0)) {
        await this.audit.record(this.sessionAuditEntry(principalType, userId, audit, families.length), tx);
      }
    });

    await this.sessions?.forget(principalType, userId, families);
    return families;
  }

  private sessionAuditEntry(principalType: PrincipalType, userId: number, audit: SessionAudit, sessionsRevoked: number): CreateAuditLogDto {
    const isStaff = principalType === PRINCIPAL_TYPE.STAFF;
    return {
      moduleName: isStaff ? AUDIT_MODULE.USERS : AUDIT_MODULE.CUSTOMERS,
      entityId: userId,
      action: audit.action,
      newValue: { ...audit.newValue, sessionsRevoked },
      // A customer id is not a users.id, so it is never recorded as the acting staff user.
      performedBy: isStaff ? userId : undefined,
    };
  }

  /** The sessions that make up "the one making this request": its own `sid`, never a client-supplied header. A token
   *  issued before `sid` existed has none and falls back to the (validated) device label, as before, until it expires. */
  private async sessionsToKeep(principal: AuthPrincipal, principalType: PrincipalType, legacyDeviceId?: string): Promise<string[]> {
    if (principal.sid) return [principal.sid];
    return legacyDeviceId ? this.familiesOnDevice(principalType, principal.sub, legacyDeviceId, true) : [];
  }

  /** The principal's sessions that still have a usable refresh token: their family and the device it is on (if any). */
  private findLiveSessions(principalType: PrincipalType, userId: number, now: Date = new Date()): Promise<Pick<RefreshToken, 'family' | 'deviceId'>[]> {
    return this.refreshTokens.find({
      select: { family: true, deviceId: true },
      where: { principalType, userId, revokedAt: IsNull(), expiresAt: MoreThan(now) },
    });
  }

  /** True when the device exists and has been signed out (so a session that is still live on it must not continue). */
  private async isDeviceSignedOut(principalType: PrincipalType, userId: number, deviceId: string): Promise<boolean> {
    const device = await this.devices.findOne({ where: { principalType, userId, deviceId } });
    return !!device && !device.isActive;
  }

  /** The sessions (families) that have a refresh token on this device — any token, so a session whose latest token lost
   *  its device label is still found — or, with `liveOnly`, only those that are still live. */
  private async familiesOnDevice(principalType: PrincipalType, userId: number, deviceId: string, liveOnly = false): Promise<string[]> {
    const query = this.refreshTokens
      .createQueryBuilder('rt')
      .select('rt.family', 'family')
      .distinct(true)
      .where('rt.user_id = :userId AND rt.principal_type = :principalType AND rt.device_id = :deviceId', { userId, principalType, deviceId });
    if (liveOnly) query.andWhere('rt.revoked_at IS NULL AND rt.expires_at > :now', { now: new Date() });

    const rows = await query.getRawMany<{ family: string }>();
    return rows.map((row) => row.family);
  }

  /**
   * Creates or refreshes the device row of a session. Only a SIGN-IN (a new session) may revive a signed-out device and
   * stamp `lastLoginAt`; a refresh only updates the activity of a device that is still active, so it can never bring
   * back a device that was signed out.
   */
  private async upsertDevice(
    principalType: PrincipalType,
    userId: number,
    ctx: DeviceContext,
    refreshTokenHash: string,
    expiresAt: Date,
    isSignIn: boolean,
    rememberMe: boolean,
  ): Promise<void> {
    const now = new Date();
    const uaInfo = parseUserAgent(ctx.userAgent);
    const existing = await this.devices.findOne({ where: { principalType, userId, deviceId: ctx.deviceId! } });

    if (existing) {
      if (!isSignIn && !existing.isActive) return;
      await this.devices.update(existing.id, {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        ...uaInfo,
        refreshTokenHash,
        ...(isSignIn ? { lastLoginAt: now } : {}),
        lastActivityAt: now,
        expiresAt,
        rememberMe,
        isActive: true,
      });
    } else {
      await this.devices.save(
        this.devices.create({
          principalType,
          userId,
          deviceId: ctx.deviceId!,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          ...uaInfo,
          refreshTokenHash,
          lastLoginAt: now,
          lastActivityAt: now,
          expiresAt,
          rememberMe,
          isActive: true,
          isTrusted: false,
        }),
      );
    }
  }

  private hashToken(token: string): string {
    return createHash(HASH_ALGORITHM).update(token).digest(HEX_ENCODING);
  }

  /** The lifetime a session's refresh token gets: REFRESH_TOKEN_EXPIRES_IN, or — for a "Remember me" session — the longer
   *  REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN (never shorter than the normal one: see refreshTokenLifetime). A blank remembered
   *  value counts as unset, so it falls back to the default. Only a remembered session reads the remembered setting. */
  private refreshLifetimeFor(rememberMe: boolean): string {
    const standard = this.config.get<string>(ENV_KEY.REFRESH_TOKEN_EXPIRES_IN, DEFAULT_REFRESH_TOKEN_EXPIRES_IN);
    if (!rememberMe) return standard;
    const configured = (this.config.get<string>(ENV_KEY.REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN) ?? '').trim();
    return refreshTokenLifetime(true, standard, configured || DEFAULT_REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN);
  }

  private parseExpiry(expiry: string): Date {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error(`Invalid expiry format: ${expiry}`);
    const value = parseInt(match[1], 10);
    return new Date(Date.now() + value * DURATION_UNIT_MS[match[2]]);
  }
}

/** Same masking convention as MailService's own maskEmail — used here only for login log lines, so
 *  a server log can show which account a login attempt/success/failure was for without ever
 *  printing a full email address, let alone a password or hash. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const maskedLocal = local.length <= 2 ? '*'.repeat(local.length) : `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

/** A SESSION_TIMEOUT_MINUTES candidate as a positive whole number of minutes, or null when it is missing or malformed. */
function toWholeMinutes(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const minutes = typeof raw === 'number' ? raw : Number(raw.trim());
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

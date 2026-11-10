import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserAuthState, UserService } from '../../modules/user/user.service';
import { CustomerService } from '../../modules/customer/customer.service';
import { CustomerAccountStatus } from '../../modules/customer/entities/customer.entity';
import { AuthPrincipal } from '../interfaces/authenticated-user.interface';
import { SessionLivenessService } from '../session-liveness.service';
import { SESSION_ERROR_MESSAGES } from '../session.constants';
import { ENV_KEY } from '../../common/constants/env.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { PRINCIPAL_TYPE } from '../../common/constants/auth.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UserService,
    private readonly customers: CustomerService,
    private readonly sessions: SessionLivenessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>(ENV_KEY.JWT_SECRET),
      // Tokens are only ever signed with HS256; accepting just that closes off algorithm-confusion
      // tricks instead of trusting whatever the token header claims.
      algorithms: ['HS256'],
    });
  }

  /** Re-verifies the token's subject against its OWN table on every request — never trusts the
   *  JWT payload alone, so a deactivated/deleted account is rejected immediately even with an
   *  otherwise still-valid, unexpired token. Branches on `type` (see AuthPrincipal's own doc
   *  comment): a 'customer' token's `sub` is a Customer id and is checked against Customer/
   *  accountStatus, NEVER against the User table — the two id spaces are independent, so treating
   *  a customer token's `sub` as a User id could otherwise either 404 or, worse, silently match an
   *  unrelated staff User row that happens to share that numeric id.
   *
   *  `accountStatus === ACTIVE` is NOT required here anymore — same corrected rule as
   *  AuthService.login()/refresh(): a Customer who has completed account setup (set a password) but
   *  is still awaiting a required Security Deposit stays INACTIVE right up until
   *  RegistrationRequestService.verifyDeposit() flips it, and must still be able to use an
   *  already-issued token to reach the restricted registration-completion flow on every subsequent
   *  request — CustomerAccessGuard/`portalAccess`, not this per-request re-verification, is what
   *  restricts what that session can reach. `OVERDUE` is the one value that still rejects here (an
   *  existing, separate billing-suspension concept — see CustomerAccountStatus's own doc comment).
   *
   *  STALE-CLAIM RULE (staff): the token's `roleId`/`roleName` are NEVER used for a decision. The
   *  user's live state — active flag, live role set, and whether a password change is required — is
   *  re-read here on every request (UserService.findAuthState: two lean queries) and attached to the
   *  principal as `roleIds`/`roleNames`/`mustChangePassword`, in assignment order, while the singular
   *  `roleId`/`roleName` are overwritten with the live PRIMARY (first) role. So a role revoked or
   *  granted after the token was issued takes effect on the very next request made with the SAME,
   *  still-unexpired token, and a user whose roles were all removed is rejected immediately. Deliberately
   *  uncached — a cache here would reintroduce exactly the staleness this closes.
   *
   *  SESSION BINDING (staff and customers): a token that carries `sid` is honoured only while its session — the
   *  refresh-token family it was issued for — still has a live refresh token. Signing out, "sign out others", a
   *  password change, an admin revoke or a replayed refresh token revoke those tokens, so the access token dies on its
   *  next request instead of when it would have expired. A token without `sid` (issued before this check existed) is
   *  not checked and simply runs out; the refresh that follows issues a bound one. */
  async validate(payload: AuthPrincipal): Promise<AuthPrincipal> {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_TOKEN_PAYLOAD);
    }

    await this.assertSessionIsLive(payload);

    if (payload.type === PRINCIPAL_TYPE.CUSTOMER) {
      try {
        const customer = await this.customers.findOne(payload.sub);
        if (customer.accountStatus === CustomerAccountStatus.OVERDUE) {
          throw new UnauthorizedException(ERROR_MESSAGES.ACCOUNT_NOT_ACTIVE);
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        throw new UnauthorizedException(ERROR_MESSAGES.CUSTOMER_NOT_FOUND);
      }
      return payload;
    }

    if (!payload.roleName) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_TOKEN_PAYLOAD);
    }

    let state: UserAuthState;
    try {
      state = await this.users.findAuthState(payload.sub);
    } catch {
      throw new UnauthorizedException(ERROR_MESSAGES.USER_NOT_FOUND);
    }
    if (!state.active) {
      throw new UnauthorizedException(ERROR_MESSAGES.ACCOUNT_DEACTIVATED);
    }

    // Same rule as login()/refresh(), enforced per request: without it a user whose last role was
    // just revoked would still pass every route that carries only @Authenticated, which the guards
    // allow for any signed-in session.
    if (state.roles.length === 0) {
      throw new UnauthorizedException(ERROR_MESSAGES.NO_ROLE_ASSIGNED);
    }

    const [primaryRole] = state.roles;
    return {
      ...payload,
      roleId: primaryRole.id,
      roleName: primaryRole.roleName,
      roleIds: state.roles.map((r) => r.id),
      roleNames: state.roles.map((r) => r.roleName),
      mustChangePassword: state.mustChangePassword,
    };
  }

  private async assertSessionIsLive(payload: AuthPrincipal): Promise<void> {
    if (payload.sid === undefined) return;

    const principalType = payload.type === PRINCIPAL_TYPE.CUSTOMER ? PRINCIPAL_TYPE.CUSTOMER : PRINCIPAL_TYPE.STAFF;
    const live = typeof payload.sid === 'string' && payload.sid !== '' && (await this.sessions.isLive(principalType, payload.sub, payload.sid));
    if (!live) {
      throw new UnauthorizedException(SESSION_ERROR_MESSAGES.SESSION_ENDED);
    }
  }
}

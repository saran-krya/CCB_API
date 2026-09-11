import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserService } from '../modules/user/user.service';
import { CustomerService } from '../modules/customer/customer.service';
import { CustomerAccountStatus } from '../modules/customer/entities/customer.entity';
import { AttributeService } from '../modules/attribute/attribute.service';
import { LovService } from '../modules/lov/lov.service';
import { RegistrationRequestService } from '../modules/registration-request/registration-request.service';
import { computePortalAccess } from '../modules/registration-request/entities/registration-request.entity';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { LoginHistoryDto } from './dto/login-history-response.dto';
import { BootstrapResponseDto } from './dto/bootstrap-response.dto';
import { AuthPrincipal } from './interfaces/authenticated-user.interface';
import { DeviceContext } from './interfaces/device-context.interface';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserLoginHistory } from './entities/user-login-history.entity';
import { UserDeviceDto } from './dto/device-response.dto';

// Same convention as CustomerService's own PASSWORD_HASH_ROUNDS (bcryptjs, 12 rounds) — kept as its
// own local constant rather than a cross-module import for one magic number.
const PASSWORD_HASH_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UserService,
    private readonly customers: CustomerService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly attributes: AttributeService,
    private readonly lov: LovService,
    private readonly registrationRequests: RegistrationRequestService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(UserDevice)
    private readonly devices: Repository<UserDevice>,
    @InjectRepository(UserLoginHistory)
    private readonly loginHistory: Repository<UserLoginHistory>,
  ) {}

  /** Tries the staff User table first (the existing, larger population), then falls back to
   *  Customer — the two id/email spaces are fully independent, so this is a strict either/or, never
   *  a merge. Logs only the outcome and which table matched (never the password/hash) — enough to
   *  tell "no such account", "wrong password", and "which session type" apart from the server logs
   *  without ever exposing credentials. */
  async login(dto: LoginDto, deviceCtx?: DeviceContext): Promise<TokenResponseDto> {
    const user = await this.users.findByEmailWithRole(dto.email);
    if (user) {
      if (!user.passwordHash || !user.active) {
        this.logger.warn(`Staff login rejected for ${maskEmail(dto.email)} — inactive account or no password set`);
        throw new UnauthorizedException('Invalid credentials');
      }

      const valid = await bcrypt.compare(dto.password, user.passwordHash);
      if (!valid) {
        this.logger.warn(`Staff login rejected for ${maskEmail(dto.email)} — password mismatch`);
        throw new UnauthorizedException('Invalid credentials');
      }

      await this.users.updateLastLogin(user.id);
      await this.insertLoginHistory('staff', user.id, deviceCtx);
      this.logger.log(`Staff login succeeded for ${maskEmail(dto.email)} (userId=${user.id})`);

      return this.issueTokenPair(
        { sub: user.id, email: user.email, roleId: user.role.id, roleName: user.role.roleName, type: 'staff' },
        undefined,
        deviceCtx,
      );
    }

    const customer = await this.customers.findByEmailForLogin(dto.email);
    // `accountStatus === ACTIVE` is NOT required to log in — a Customer who has completed account
    // setup (set a password) but is still awaiting a required Security Deposit stays `INACTIVE`
    // until RegistrationRequestService.verifyDeposit() flips it (see Customer.entity's own doc
    // comment and CustomerService.activate()'s own doc comment on this exact split); that Customer
    // must still be able to log in to reach the restricted registration-completion flow —
    // `portalAccess`/CustomerAccessGuard is what restricts what they can do once logged in, not
    // login itself. `OVERDUE` is the one accountStatus value that DOES still block login outright
    // (an existing, separate billing-suspension concept, unrelated to this activation flow — see
    // CustomerAccountStatus's own doc comment).
    if (!customer?.passwordHash || customer.accountStatus === CustomerAccountStatus.OVERDUE) {
      this.logger.warn(`Customer login rejected for ${maskEmail(dto.email)} — no account, no password set, or overdue`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, customer.passwordHash);
    if (!valid) {
      this.logger.warn(`Customer login rejected for ${maskEmail(dto.email)} — password mismatch`);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.insertLoginHistory('customer', customer.id, deviceCtx);
    this.logger.log(`Customer login succeeded for ${maskEmail(dto.email)} (customerId=${customer.id})`);

    return this.issueTokenPair(
      { sub: customer.id, email: customer.email!, type: 'customer' },
      undefined,
      deviceCtx,
    );
  }

  /** Re-verifies against the SAME table the original session was issued from — `stored.principalType`
   *  (never the caller's own assumption) decides whether this refresh token's `userId` is looked up
   *  in `users` or `customers`, and the re-issued token carries that same type forward. This is what
   *  makes "refresh preserves the correct identity type" true: before principalType existed, this
   *  method always called `this.users.findOne(stored.userId)` regardless of which table actually
   *  issued the token — a customer's refresh would either 404 or, worse, silently resolve an
   *  unrelated staff User row that happened to share the same numeric id, then hand back a
   *  fabricated STAFF-typed token for a customer session. */
  async refresh(rawToken: string, deviceCtx?: DeviceContext): Promise<TokenResponseDto> {
    const hash = this.hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash: hash } });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.family);
      if (stored.deviceId) {
        await this.devices.update(
          { principalType: stored.principalType, deviceId: stored.deviceId, userId: stored.userId },
          { isActive: false },
        );
      }
      throw new UnauthorizedException('Refresh token already used');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (deviceCtx?.deviceId && stored.deviceId && stored.deviceId !== deviceCtx.deviceId) {
      throw new UnauthorizedException('Device mismatch');
    }

    await this.refreshTokens.update(stored.id, { revokedAt: new Date() });

    const effectiveCtx = deviceCtx ?? (stored.deviceId ? { deviceId: stored.deviceId } : undefined);

    if (stored.principalType === 'customer') {
      let customer;
      try {
        customer = await this.customers.findOne(stored.userId);
      } catch {
        throw new UnauthorizedException('Customer not found');
      }
      // Same relaxed rule as login() above — a restricted (deposit-pending) Customer's refresh
      // token must keep working, only OVERDUE (a separate, existing billing-suspension concept)
      // actually revokes access here.
      if (customer.accountStatus === CustomerAccountStatus.OVERDUE) {
        throw new UnauthorizedException('Account is not active');
      }
      return this.issueTokenPair(
        { sub: customer.id, email: customer.email!, type: 'customer' },
        stored.family,
        effectiveCtx,
      );
    }

    let user;
    try {
      user = await this.users.findOne(stored.userId);
    } catch {
      throw new UnauthorizedException('User not found');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    return this.issueTokenPair(
      { sub: user.id, email: user.email, roleId: user.role.id, roleName: user.role.roleName, type: 'staff' },
      stored.family,
      effectiveCtx,
    );
  }

  async logout(rawToken: string): Promise<void> {
    const hash = this.hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash: hash } });
    if (stored) {
      await this.refreshTokens.update({ tokenHash: hash }, { revokedAt: new Date() });
      if (stored.deviceId) {
        await this.devices.update(
          { principalType: stored.principalType, deviceId: stored.deviceId, userId: stored.userId },
          { isActive: false },
        );
        await this.closeLoginHistory(stored.principalType, stored.userId, stored.deviceId);
      }
    }
  }

  async logoutDevice(principalType: 'staff' | 'customer', deviceId: string, userId: number): Promise<void> {
    const device = await this.devices.findOne({ where: { principalType, deviceId, userId } });
    if (!device) throw new NotFoundException('Device not found');

    await this.refreshTokens
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('device_id = :deviceId AND user_id = :userId AND principal_type = :principalType AND revoked_at IS NULL', { deviceId, userId, principalType })
      .execute();

    await this.devices.update({ id: device.id }, { isActive: false });
    await this.closeLoginHistory(principalType, userId, deviceId);
  }

  /**
   * `exceptDeviceId` — when set (the change-password flow's own use), the CALLER's own device/
   * refresh-token row survives so changing your password from an active session doesn't
   * immediately log you out of that same session; every other device is revoked exactly as before.
   * Omitted (the existing "Log out everywhere" security action) revokes all devices, unchanged.
   * MySQL (not Postgres) — `!= :x OR col IS NULL` rather than `IS DISTINCT FROM`, which MySQL
   * doesn't support; a NULL device_id row must still be revoked, since `!=` against NULL is never
   * true and would otherwise silently exclude it.
   */
  async logoutAll(principalType: 'staff' | 'customer', userId: number, exceptDeviceId?: string): Promise<void> {
    const exceptClause = exceptDeviceId ? ' AND (device_id != :exceptDeviceId OR device_id IS NULL)' : '';
    const params = { userId, principalType, exceptDeviceId };

    await this.refreshTokens
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where(`user_id = :userId AND principal_type = :principalType AND revoked_at IS NULL${exceptClause}`, params)
      .execute();

    await this.devices
      .createQueryBuilder()
      .update()
      .set({ isActive: false })
      .where(`principal_type = :principalType AND user_id = :userId${exceptClause}`, params)
      .execute();

    await this.closeAllLoginHistory(principalType, userId, exceptDeviceId);
  }

  /**
   * Same either/or branch as login() — staff (User) vs. Customer, never both. Requires the
   * CURRENT password (bcrypt-compared against the existing hash, same convention as login) before
   * writing a new one, so a hijacked/unattended active session can't silently lock the real owner
   * out just by holding a valid access token. On success, every OTHER device is revoked
   * (logoutAll's own `exceptDeviceId`) — the caller's own current session survives so they aren't
   * immediately logged out by the very action they just took.
   */
  async changePassword(
    principal: AuthPrincipal,
    dto: { currentPassword: string; newPassword: string },
    deviceCtx?: DeviceContext,
  ): Promise<void> {
    const principalType: 'staff' | 'customer' = principal.type === 'customer' ? 'customer' : 'staff';

    if (principalType === 'staff') {
      const user = await this.users.findByIdWithPasswordHash(principal.sub);
      if (!user?.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }
      const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!valid) {
        this.logger.warn(`Password change rejected for staff userId=${principal.sub} — current password mismatch`);
        throw new UnauthorizedException('Current password is incorrect');
      }
      const newHash = await bcrypt.hash(dto.newPassword, PASSWORD_HASH_ROUNDS);
      await this.users.setPasswordHash(principal.sub, newHash);
      this.logger.log(`Password changed for staff userId=${principal.sub}`);
    } else {
      const customer = await this.customers.findByIdWithPasswordHash(principal.sub);
      if (!customer?.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }
      const valid = await bcrypt.compare(dto.currentPassword, customer.passwordHash);
      if (!valid) {
        this.logger.warn(`Password change rejected for customerId=${principal.sub} — current password mismatch`);
        throw new UnauthorizedException('Current password is incorrect');
      }
      const newHash = await bcrypt.hash(dto.newPassword, PASSWORD_HASH_ROUNDS);
      await this.customers.setPasswordHash(principal.sub, newHash);
      this.logger.log(`Password changed for customerId=${principal.sub}`);
    }

    await this.logoutAll(principalType, principal.sub, deviceCtx?.deviceId);
  }

  async getDevices(principalType: 'staff' | 'customer', userId: number, currentDeviceId?: string): Promise<UserDeviceDto[]> {
    const list = await this.devices.find({
      where: { principalType, userId, isActive: true },
      order: { lastActivityAt: 'DESC' },
    });

    return list.map((d) => ({
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
      isTrusted: d.isTrusted,
      isCurrentDevice: !!currentDeviceId && d.deviceId === currentDeviceId,
    }));
  }

  async getLoginHistory(principalType: 'staff' | 'customer', userId: number, limit = 20): Promise<LoginHistoryDto[]> {
    const records = await this.loginHistory.find({
      where: { principalType, userId },
      order: { loginAt: 'DESC' },
      take: limit,
    });

    return records.map((r) => ({
      id: r.id,
      deviceId: r.deviceId ?? null,
      ipAddress: r.ipAddress ?? null,
      browser: r.browser ?? null,
      platform: r.platform ?? null,
      loginAt: r.loginAt.toISOString(),
      logoutAt: r.logoutAt?.toISOString() ?? null,
    }));
  }

  async issueTokenPair(
    payload: AuthPrincipal,
    family: string = randomUUID(),
    deviceCtx?: DeviceContext,
  ): Promise<TokenResponseDto> {
    const accessTokenExpiresIn = await this.resolveAccessTokenExpiry();
    const accessToken = this.jwt.sign(payload, { expiresIn: accessTokenExpiresIn });

    const principalType: 'staff' | 'customer' = payload.type === 'customer' ? 'customer' : 'staff';
    const rawRefreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const refreshExpiresIn = this.config.get<string>('REFRESH_TOKEN_EXPIRES_IN', '7d');
    const expiresAt = this.parseExpiry(refreshExpiresIn);

    await this.refreshTokens.save(
      this.refreshTokens.create({
        tokenHash,
        principalType,
        userId: payload.sub,
        family,
        deviceId: deviceCtx?.deviceId,
        expiresAt,
      }),
    );

    if (deviceCtx?.deviceId) {
      await this.upsertDevice(principalType, payload.sub, deviceCtx, tokenHash, expiresAt);
    }

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: accessTokenExpiresIn,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresIn: refreshExpiresIn,
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
    const [profileResult, sessionTimeoutRaw, languages, depositResult] = await Promise.all([
      principal.type === 'customer'
        ? this.customers.findOne(principal.sub)
        : this.users.getProfile(principal.sub),
      this.attributes.getValueByKey('SESSION_TIMEOUT_MINUTES'),
      this.lov.findActiveLanguages(),
      // Only meaningful for a customer session — fetched unconditionally alongside the rest so this
      // stays one Promise.all rather than a second network round-trip, and simply unused for staff.
      // Only `depositStatus` is actually used below — `customer.accountStatus` (fetched via
      // `profileResult` above) is the live accountStatus computePortalAccess needs, not this call's
      // own `accountStatus` field (same underlying column, no point reading it twice).
      principal.type === 'customer' ? this.registrationRequests.getMyDepositStatus(principal.sub) : null,
    ]);

    if (sessionTimeoutRaw === null) {
      throw new NotFoundException('SESSION_TIMEOUT_MINUTES is not configured');
    }

    const languagesMapped = languages.map((l) => ({
      code: l.code,
      label: l.label,
      direction: l.direction ?? null,
      localeCode: l.localeCode ?? null,
    }));

    if (principal.type === 'customer') {
      const customer = profileResult as Awaited<ReturnType<CustomerService['findOne']>>;
      return {
        type: 'customer',
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
        sessionConfig: { idleTimeoutMinutes: Number(sessionTimeoutRaw) },
        languages: languagesMapped,
      };
    }

    return {
      type: 'staff',
      profile: profileResult as Awaited<ReturnType<UserService['getProfile']>>,
      sessionConfig: { idleTimeoutMinutes: Number(sessionTimeoutRaw) },
      languages: languagesMapped,
    };
  }

  private async resolveAccessTokenExpiry(): Promise<string> {
    const raw = await this.attributes.getValueByKey('SESSION_TIMEOUT_MINUTES');
    const minutes = raw ? Number(raw) : NaN;
    if (Number.isFinite(minutes) && minutes > 0) {
      return `${minutes}m`;
    }
    return this.config.getOrThrow<string>('JWT_EXPIRES_IN');
  }

  private async insertLoginHistory(principalType: 'staff' | 'customer', userId: number, deviceCtx?: DeviceContext): Promise<void> {
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

    const uaInfo = this.parseUserAgent(deviceCtx?.userAgent);
    await this.loginHistory.save(
      this.loginHistory.create({
        principalType,
        userId,
        deviceId: deviceCtx?.deviceId ?? null,
        ipAddress: deviceCtx?.ipAddress ?? null,
        browser: uaInfo.browser ?? null,
        platform: uaInfo.operatingSystem ?? null,
      }),
    );
  }

  private async closeLoginHistory(principalType: 'staff' | 'customer', userId: number, deviceId: string): Promise<void> {
    await this.loginHistory
      .createQueryBuilder()
      .update()
      .set({ logoutAt: new Date() })
      .where('user_id = :userId AND principal_type = :principalType AND device_id = :deviceId AND logout_at IS NULL', { userId, principalType, deviceId })
      .execute();
  }

  private async closeAllLoginHistory(principalType: 'staff' | 'customer', userId: number, exceptDeviceId?: string): Promise<void> {
    const exceptClause = exceptDeviceId ? ' AND (device_id != :exceptDeviceId OR device_id IS NULL)' : '';
    await this.loginHistory
      .createQueryBuilder()
      .update()
      .set({ logoutAt: new Date() })
      .where(`user_id = :userId AND principal_type = :principalType AND logout_at IS NULL${exceptClause}`, { userId, principalType, exceptDeviceId })
      .execute();
  }

  private async upsertDevice(
    principalType: 'staff' | 'customer',
    userId: number,
    ctx: DeviceContext,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const now = new Date();
    const uaInfo = this.parseUserAgent(ctx.userAgent);
    const existing = await this.devices.findOne({ where: { principalType, userId, deviceId: ctx.deviceId! } });

    if (existing) {
      await this.devices.update(existing.id, {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        ...uaInfo,
        refreshTokenHash,
        lastLoginAt: now,
        lastActivityAt: now,
        expiresAt,
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
          isActive: true,
          isTrusted: false,
        }),
      );
    }
  }

  private parseUserAgent(ua?: string): {
    browser?: string;
    browserVersion?: string;
    operatingSystem?: string;
    osVersion?: string;
    deviceType?: string;
    deviceName?: string;
  } {
    if (!ua) return {};

    let browser: string | undefined;
    let browserVersion: string | undefined;
    let operatingSystem: string | undefined;
    let osVersion: string | undefined;
    let deviceType = 'desktop';

    if (/mobile/i.test(ua)) deviceType = 'mobile';
    else if (/tablet|ipad/i.test(ua)) deviceType = 'tablet';

    const ntMatch = ua.match(/windows nt (\d+\.\d+)/i);
    if (ntMatch) {
      operatingSystem = 'Windows';
      const ntMap: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
      osVersion = ntMap[ntMatch[1]] ?? ntMatch[1];
    } else {
      const macMatch = ua.match(/mac os x (\d+[._]\d+)/i);
      const andMatch = ua.match(/android (\d+[.\d]*)/i);
      const iosMatch = ua.match(/iphone os (\d+[_\d]*)/i);
      if (macMatch) {
        operatingSystem = 'macOS';
        osVersion = macMatch[1].replace(/_/g, '.');
      } else if (andMatch) {
        operatingSystem = 'Android';
        osVersion = andMatch[1];
        deviceType = 'mobile';
      } else if (iosMatch) {
        operatingSystem = 'iOS';
        osVersion = iosMatch[1].replace(/_/g, '.');
        deviceType = 'mobile';
      } else if (/linux/i.test(ua)) {
        operatingSystem = 'Linux';
      }
    }

    const edgeMatch = ua.match(/edg\/(\d+[\d.]*)/i);
    const chromeMatch = ua.match(/chrome\/(\d+[\d.]*)/i);
    const ffMatch = ua.match(/firefox\/(\d+[\d.]*)/i);
    const safariMatch = ua.match(/version\/(\d+[\d.]*)/i);

    if (edgeMatch) {
      browser = 'Edge';
      browserVersion = edgeMatch[1];
    } else if (chromeMatch && !/chromium/i.test(ua)) {
      browser = 'Chrome';
      browserVersion = chromeMatch[1];
    } else if (ffMatch) {
      browser = 'Firefox';
      browserVersion = ffMatch[1];
    } else if (safariMatch && /safari/i.test(ua) && !/chrome/i.test(ua)) {
      browser = 'Safari';
      browserVersion = safariMatch[1];
    }

    const deviceName =
      browser && operatingSystem ? `${browser} on ${operatingSystem}` : undefined;

    return { browser, browserVersion, operatingSystem, osVersion, deviceType, deviceName };
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.refreshTokens.update({ family }, { revokedAt: new Date() });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiry(expiry: string): Date {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error(`Invalid expiry format: ${expiry}`);
    const value = parseInt(match[1], 10);
    const ms: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return new Date(Date.now() + value * ms[match[2]]);
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

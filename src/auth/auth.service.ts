import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserService } from '../modules/user/user.service';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { DeviceContext } from './interfaces/device-context.interface';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserDeviceDto } from './dto/device-response.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(UserDevice)
    private readonly devices: Repository<UserDevice>,
  ) {}

  async login(dto: LoginDto, deviceCtx?: DeviceContext): Promise<TokenResponseDto> {
    const user = await this.users.findByEmailWithRole(dto.email);

    if (!user?.passwordHash || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.users.updateLastLogin(user.id);

    return this.issueTokenPair(
      { sub: user.id, email: user.email, roleId: user.role.id, roleName: user.role.roleName },
      undefined,
      deviceCtx,
    );
  }

  async refresh(rawToken: string, deviceCtx?: DeviceContext): Promise<TokenResponseDto> {
    const hash = this.hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash: hash } });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Reuse attack — revoke every token in this family immediately
      await this.revokeFamily(stored.family);
      if (stored.deviceId) {
        await this.devices.update({ deviceId: stored.deviceId, userId: stored.userId }, { isActive: false });
      }
      throw new UnauthorizedException('Refresh token already used');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (deviceCtx?.deviceId && stored.deviceId && stored.deviceId !== deviceCtx.deviceId) {
      throw new UnauthorizedException('Device mismatch');
    }

    // Invalidate the consumed token before issuing the next pair
    await this.refreshTokens.update(stored.id, { revokedAt: new Date() });

    let user;
    try {
      user = await this.users.findOne(stored.userId);
    } catch {
      throw new UnauthorizedException('User not found');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Carry forward the deviceId from the stored token when not sent in the request
    const effectiveCtx = deviceCtx ?? (stored.deviceId ? { deviceId: stored.deviceId } : undefined);

    return this.issueTokenPair(
      { sub: user.id, email: user.email, roleId: user.role.id, roleName: user.role.roleName },
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
          { deviceId: stored.deviceId, userId: stored.userId },
          { isActive: false },
        );
      }
    }
  }

  async logoutDevice(deviceId: string, userId: number): Promise<void> {
    const device = await this.devices.findOne({ where: { deviceId, userId } });
    if (!device) throw new NotFoundException('Device not found');

    await this.refreshTokens
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('device_id = :deviceId AND user_id = :userId AND revoked_at IS NULL', { deviceId, userId })
      .execute();

    await this.devices.update({ id: device.id }, { isActive: false });
  }

  async logoutAll(userId: number): Promise<void> {
    await this.refreshTokens
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();

    await this.devices.update({ userId }, { isActive: false });
  }

  async getDevices(userId: number, currentDeviceId?: string): Promise<UserDeviceDto[]> {
    const list = await this.devices.find({
      where: { userId, isActive: true },
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

  async issueTokenPair(
    payload: AuthenticatedUser,
    family: string = randomUUID(),
    deviceCtx?: DeviceContext,
  ): Promise<TokenResponseDto> {
    const accessToken = this.jwt.sign(payload);

    const rawRefreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const refreshExpiresIn = this.config.get<string>('REFRESH_TOKEN_EXPIRES_IN', '7d');
    const expiresAt = this.parseExpiry(refreshExpiresIn);

    await this.refreshTokens.save(
      this.refreshTokens.create({
        tokenHash,
        userId: payload.sub,
        family,
        deviceId: deviceCtx?.deviceId,
        expiresAt,
      }),
    );

    if (deviceCtx?.deviceId) {
      await this.upsertDevice(payload.sub, deviceCtx, tokenHash, expiresAt);
    }

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow<string>('JWT_EXPIRES_IN'),
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

  private async upsertDevice(
    userId: number,
    ctx: DeviceContext,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const now = new Date();
    const uaInfo = this.parseUserAgent(ctx.userAgent);
    const existing = await this.devices.findOne({ where: { userId, deviceId: ctx.deviceId! } });

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

import { Injectable, UnauthorizedException } from '@nestjs/common';
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
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  async login(dto: LoginDto): Promise<TokenResponseDto> {
    const user = await this.users.findByEmailWithRole(dto.email);

    if (!user?.passwordHash || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.users.updateLastLogin(user.id);

    return this.issueTokenPair({
      sub: user.id,
      email: user.email,
      roleId: user.role.id,
      roleName: user.role.roleName,
    });
  }

  async refresh(rawToken: string): Promise<TokenResponseDto> {
    const hash = this.hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash: hash } });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Reuse attack — revoke every token in this family immediately
      await this.revokeFamily(stored.family);
      throw new UnauthorizedException('Refresh token already used');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
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

    return this.issueTokenPair(
      {
        sub: user.id,
        email: user.email,
        roleId: user.role.id,
        roleName: user.role.roleName,
      },
      stored.family,
    );
  }

  async logout(rawToken: string): Promise<void> {
    const hash = this.hashToken(rawToken);
    await this.refreshTokens.update({ tokenHash: hash }, { revokedAt: new Date() });
  }

  async issueTokenPair(
    payload: AuthenticatedUser,
    family: string = randomUUID(),
  ): Promise<TokenResponseDto> {
    const accessToken = this.jwt.sign(payload);

    const rawRefreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const refreshExpiresIn = this.config.get<string>('REFRESH_TOKEN_EXPIRES_IN', '7d');

    await this.refreshTokens.save(
      this.refreshTokens.create({
        tokenHash,
        userId: payload.sub,
        family,
        expiresAt: this.parseExpiry(refreshExpiresIn),
      }),
    );

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

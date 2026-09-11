import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../../modules/user/user.service';
import { CustomerService } from '../../modules/customer/customer.service';
import { CustomerAccountStatus } from '../../modules/customer/entities/customer.entity';
import { AuthPrincipal } from '../interfaces/authenticated-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UserService,
    private readonly customers: CustomerService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
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
   *  existing, separate billing-suspension concept — see CustomerAccountStatus's own doc comment). */
  async validate(payload: AuthPrincipal): Promise<AuthPrincipal> {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (payload.type === 'customer') {
      try {
        const customer = await this.customers.findOne(payload.sub);
        if (customer.accountStatus === CustomerAccountStatus.OVERDUE) {
          throw new UnauthorizedException('Account is not active');
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        throw new UnauthorizedException('Customer not found');
      }
      return payload;
    }

    if (!payload.roleName) {
      throw new UnauthorizedException('Invalid token payload');
    }

    try {
      const user = await this.users.findOne(payload.sub);
      if (!user.active) {
        throw new UnauthorizedException('Account is deactivated');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('User not found');
    }

    return payload;
  }
}

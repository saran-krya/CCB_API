import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PRINCIPAL_TYPE } from '../common/constants/auth.constants';
import { Customer } from '../modules/customer/entities/customer.entity';
import { User } from '../modules/user/entities/user.entity';
import { UserLoginHistory } from './entities/user-login-history.entity';

/**
 * "Has this client (IP address) signed in to this account before?" — answered from the sign-in history (successful sign-ins only are recorded
 * there, with the client's address). The lock-out uses it for ONE decision: while an account is under a distributed guessing attack (many failures
 * from many addresses), only a client that has signed in to it recently may still try; a stranger is refused. That is what stops a stranger from
 * locking the owner out of their own account by deliberately failing — see LoginAttemptsService.
 */
@Injectable()
export class KnownClientService {
  constructor(
    @InjectRepository(UserLoginHistory)
    private readonly history: Repository<UserLoginHistory>,
  ) {}

  /** True when a successful sign-in to the staff or customer account with this e-mail came from `ip` on or after `since`. Never throws: an
   *  unanswerable question is "no", which keeps the account protected rather than open. */
  async hasSignedInFrom(email: string, ip: string, since: Date): Promise<boolean> {
    const address = email.trim().toLowerCase();
    try {
      const staff = await this.history
        .createQueryBuilder('h')
        .innerJoin(User, 'u', 'u.id = h.userId AND h.principalType = :staff', { staff: PRINCIPAL_TYPE.STAFF })
        .where('LOWER(u.email) = :address', { address })
        .andWhere('h.ipAddress = :ip', { ip })
        .andWhere('h.loginAt >= :since', { since })
        .select('h.id', 'id')
        .limit(1)
        .getRawOne();
      if (staff) return true;

      const customer = await this.history
        .createQueryBuilder('h')
        .innerJoin(Customer, 'c', 'c.id = h.userId AND h.principalType = :customer', { customer: PRINCIPAL_TYPE.CUSTOMER })
        .where('LOWER(c.email) = :address', { address })
        .andWhere('h.ipAddress = :ip', { ip })
        .andWhere('h.loginAt >= :since', { since })
        .select('h.id', 'id')
        .limit(1)
        .getRawOne();
      return !!customer;
    } catch {
      return false;
    }
  }
}

/** What LoginAttemptsService needs from it (so a test can supply a one-method fake). */
export type KnownClientLookup = Pick<KnownClientService, 'hasSignedInFrom'>;

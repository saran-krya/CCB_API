import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UserService } from '../modules/user/user.service';

// RBAC/Create-User-wizard feature: a staff account created with "must change password at next
// sign-in" checked gets a real, usable password (never a broken null-password account) but the
// NEXT successful login must tell the frontend to route through the mandatory change-password
// screen before the normal app. Exercises the real AuthService.login staff branch directly (not a
// hand-copied assumption about its return shape), with every dependency it actually calls stubbed.
describe('AuthService.login — mustChangePassword flag on the staff login response', () => {
  const PASSWORD = 'CorrectHorseBatteryStaple1';
  let passwordHash: string;
  let usersStub: any;
  let authService: AuthService;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 12);
  });

  function makeUser(mustChangePassword: boolean) {
    return {
      id: 7,
      email: 'newhire@ccb.local',
      passwordHash,
      active: true,
      mustChangePassword,
    };
  }

  beforeEach(() => {
    usersStub = {
      findByEmailWithPasswordHash: jest.fn(),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    const userRolesStub = { getPrimaryRole: jest.fn().mockResolvedValue({ roleId: 3, roleName: 'OPERATIONS' }) };
    const attributesStub = { getValueByKey: jest.fn().mockResolvedValue(null) };
    const configStub = { get: jest.fn((_key: string, fallback?: string) => fallback ?? '1h'), getOrThrow: jest.fn().mockReturnValue('1h') };
    const jwtStub = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const refreshTokensRepoStub = { create: jest.fn((x: any) => x), save: jest.fn().mockResolvedValue(undefined) };
    const loginHistoryRepoStub = {
      createQueryBuilder: jest.fn().mockReturnValue({
        update: () => ({ set: () => ({ where: () => ({ execute: async () => undefined }) }) }),
      }),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((x: any) => x),
    };

    authService = new AuthService(
      usersStub,
      userRolesStub as any,
      {} as any, // CustomerService — never reached, staff branch matches first
      jwtStub as any,
      configStub as any,
      attributesStub as any,
      {} as any, // LovService — unused by login
      {} as any, // RegistrationRequestService — unused by login
      refreshTokensRepoStub as any,
      {} as any, // UserDevice repo — only touched when deviceCtx.deviceId is set; test passes none
      loginHistoryRepoStub as any,
    );
  });

  it('includes mustChangePassword: true when the account was created with the flag set', async () => {
    usersStub.findByEmailWithPasswordHash.mockResolvedValue(makeUser(true));

    const result = await authService.login({ email: 'newhire@ccb.local', password: PASSWORD });

    expect(result.mustChangePassword).toBe(true);
    expect(result.accessToken).toBe('signed.jwt.token'); // still a real, usable session either way
  });

  it('omits mustChangePassword for an ordinary account (flag false)', async () => {
    usersStub.findByEmailWithPasswordHash.mockResolvedValue(makeUser(false));

    const result = await authService.login({ email: 'newhire@ccb.local', password: PASSWORD });

    expect(result.mustChangePassword).toBeUndefined();
  });
});

describe('UserService.setPasswordHash — always clears mustChangePassword', () => {
  it('updates passwordHash and mustChangePassword together in one write', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const service = new UserService(
      { update } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );

    await service.setPasswordHash(42, 'new-hash');

    expect(update).toHaveBeenCalledWith(42, { passwordHash: 'new-hash', mustChangePassword: false });
  });
});

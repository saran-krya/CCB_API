import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptInvitationDto, InvitationQueryDto, InviteStaffDto, ValidateInvitationDto } from './account-invitation.dto';

/** Runs a payload through the same two steps the global ValidationPipe does (src/main.ts): convert with implicit conversion, then validate
 *  with whitelist + forbidNonWhitelisted. Resolves to the names of the properties that failed. */
async function failures<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain, { enableImplicitConversion: true }), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property).sort();
}

const TOKEN = 'a1b2c3d4'.repeat(8); // 64 lowercase hex characters
const STRONG_PASSWORD = 'Str0ng!Passw0rd';

describe('ValidateInvitationDto', () => {
  it('accepts a token of exactly 64 lowercase hex characters', async () => {
    expect(await failures(ValidateInvitationDto, { token: TOKEN })).toEqual([]);
  });

  it('refuses anything that cannot be a token we issued, before the database is asked', async () => {
    expect(await failures(ValidateInvitationDto, { token: TOKEN.slice(1) })).toEqual(['token']);
    expect(await failures(ValidateInvitationDto, { token: TOKEN.toUpperCase() })).toEqual(['token']);
    expect(await failures(ValidateInvitationDto, { token: `${TOKEN.slice(1)}g` })).toEqual(['token']);
    expect(await failures(ValidateInvitationDto, { token: 12345 })).toEqual(['token']);
    expect(await failures(ValidateInvitationDto, { token: { $ne: null } })).toEqual(['token']);
    expect(await failures(ValidateInvitationDto, {})).toEqual(['token']);
  });

  it('refuses a field it does not know', async () => {
    expect(await failures(ValidateInvitationDto, { token: TOKEN, role: 'SUPER_ADMIN' })).toEqual(['role']);
  });
});

describe('AcceptInvitationDto', () => {
  it('takes only a token and a password that meets the password policy', async () => {
    expect(await failures(AcceptInvitationDto, { token: TOKEN, password: STRONG_PASSWORD })).toEqual([]);
    expect(await failures(AcceptInvitationDto, { token: TOKEN, password: 'weakpass' })).toEqual(['password']);
    expect(await failures(AcceptInvitationDto, { token: TOKEN })).toEqual(['password']);
  });

  it('can never be told which roles, status or account to use — those come from the server, never the request', async () => {
    const extras = { roleIds: [1], roleName: 'SUPER_ADMIN', active: true, userId: 1, email: 'someone@example.com' };
    expect((await failures(AcceptInvitationDto, { token: TOKEN, password: STRONG_PASSWORD, ...extras })).sort()).toEqual(
      ['active', 'email', 'roleIds', 'roleName', 'userId'].sort(),
    );
  });
});

describe('InviteStaffDto', () => {
  const valid = { roleIds: [2], firstName: 'Sara', lastName: 'Ahmed', email: 'sara@example.com' };

  it('accepts the Create User details without a password', async () => {
    expect(await failures(InviteStaffDto, valid)).toEqual([]);
    expect(await failures(InviteStaffDto, { ...valid, middleName: 'M', designation: 'Engineer', mobile: '+971501234567', employeeCode: 'E1' })).toEqual([]);
  });

  it('takes the language of the invitation — English or Arabic — and nothing else', async () => {
    expect(await failures(InviteStaffDto, { ...valid, language: 'ar' })).toEqual([]);
    expect(await failures(InviteStaffDto, { ...valid, language: 'en' })).toEqual([]);
    expect(await failures(InviteStaffDto, { ...valid, language: 'fr' })).toEqual(['language']);
  });

  it('still needs a role, a name and an address, like Create User', async () => {
    expect(await failures(InviteStaffDto, { ...valid, roleIds: [] })).toEqual(['roleIds']);
    expect(await failures(InviteStaffDto, { ...valid, firstName: '' })).toEqual(['firstName']);
    expect(await failures(InviteStaffDto, { ...valid, email: 'not-an-address' })).toEqual(['email']);
  });

  it('refuses a password, an account status or a forced password change — an invited account has none of them', async () => {
    expect(await failures(InviteStaffDto, { ...valid, password: STRONG_PASSWORD })).toEqual(['password']);
    expect(await failures(InviteStaffDto, { ...valid, active: true })).toEqual(['active']);
    expect(await failures(InviteStaffDto, { ...valid, mustChangePassword: true })).toEqual(['mustChangePassword']);
  });
});

describe('InvitationQueryDto', () => {
  it('accepts the filters the Invitations screen sends', async () => {
    expect(await failures(InvitationQueryDto, { page: '2', limit: '5', principalType: 'staff', status: 'PENDING', search: 'sara' })).toEqual([]);
    expect(await failures(InvitationQueryDto, {})).toEqual([]);
  });

  it('can be narrowed to the invitation of one account', async () => {
    expect(await failures(InvitationQueryDto, { principalType: 'staff', principalId: '7' })).toEqual([]);
    expect(await failures(InvitationQueryDto, { principalId: '0' })).toEqual(['principalId']);
    expect(await failures(InvitationQueryDto, { principalId: 'abc' })).toEqual(['principalId']);
  });

  it('refuses an unknown account type or status, and a page size beyond the cap', async () => {
    expect(await failures(InvitationQueryDto, { principalType: 'admin' })).toEqual(['principalType']);
    expect(await failures(InvitationQueryDto, { status: 'DONE' })).toEqual(['status']);
    expect(await failures(InvitationQueryDto, { limit: '1000' })).toEqual(['limit']);
  });
});

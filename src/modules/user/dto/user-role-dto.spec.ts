import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AddUserRolesDto } from './add-user-roles.dto';
import { CreateUserDto, UpdateUserDto } from './create-user.dto';

// Request-validation tests for the multi-role user DTOs, run through a ValidationPipe built with the
// exact options main.ts installs globally. whitelist + forbidNonWhitelisted is what turns a stale
// client that still sends the old single `roleId` into a 400 (intended: the frontend ships in lockstep),
// and what keeps UpdateUserDto from ever accepting a role field — role changes go only through the
// dedicated POST/DELETE /users/:id/roles endpoints.
describe('user role DTO validation (global ValidationPipe options)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const validate = (metatype: new () => unknown, body: unknown) => pipe.transform(body, { type: 'body', metatype });

  /** The 400's validation messages, flattened. */
  async function rejectionMessages(metatype: new () => unknown, body: unknown): Promise<string[]> {
    const error = await validate(metatype, body).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    const { message } = (error as BadRequestException).getResponse() as { message: string | string[] };
    return Array.isArray(message) ? message : [message];
  }

  describe('CreateUserDto.roleIds', () => {
    const base = { firstName: 'New', lastName: 'Hire', email: 'new.hire@example.com' };

    it('accepts one or several role ids, keeping their order', async () => {
      await expect(validate(CreateUserDto, { ...base, roleIds: [7] })).resolves.toMatchObject({ roleIds: [7] });
      await expect(validate(CreateUserDto, { ...base, roleIds: [5, 2, 9] })).resolves.toMatchObject({ roleIds: [5, 2, 9] });
    });

    it('is required', async () => {
      expect((await rejectionMessages(CreateUserDto, base)).join(' ')).toMatch(/roleIds/);
    });

    it('rejects an empty array — a user must start with at least one role', async () => {
      expect(await rejectionMessages(CreateUserDto, { ...base, roleIds: [] })).toContain('roleIds should not be empty');
    });

    it('rejects a value that is not an array', async () => {
      expect(await rejectionMessages(CreateUserDto, { ...base, roleIds: 7 })).toContain('roleIds must be an array');
    });

    it('rejects duplicate ids', async () => {
      expect((await rejectionMessages(CreateUserDto, { ...base, roleIds: [2, 5, 2] })).join(' ')).toMatch(/unique/);
    });

    it.each([
      ['a fraction', [1.5]],
      ['a numeric string', ['2']],
      ['a boolean', [true]],
      ['null', [null]],
    ])('rejects an element that is not an integer — %s', async (_label, roleIds) => {
      expect((await rejectionMessages(CreateUserDto, { ...base, roleIds })).join(' ')).toMatch(/must be an integer number/);
    });

    it.each([[0], [-3]])('rejects a non-positive id (%i)', async (id) => {
      expect((await rejectionMessages(CreateUserDto, { ...base, roleIds: [id] })).join(' ')).toMatch(/must not be less than 1/);
    });

    it('rejects the stale single `roleId` a pre-multi-role client still sends — 400, not silently ignored', async () => {
      expect(await rejectionMessages(CreateUserDto, { ...base, roleId: 2 })).toContain('property roleId should not exist');
      expect(await rejectionMessages(CreateUserDto, { ...base, roleIds: [2], roleId: 2 })).toContain('property roleId should not exist');
    });
  });

  describe('UpdateUserDto', () => {
    it('accepts partial profile updates, including none at all', async () => {
      await expect(validate(UpdateUserDto, {})).resolves.toEqual({});
      await expect(validate(UpdateUserDto, { firstName: 'Renamed', active: false })).resolves.toMatchObject({
        firstName: 'Renamed',
        active: false,
      });
    });

    it('accepts NO role field of any kind — roles change only through POST/DELETE /users/:id/roles', async () => {
      expect(await rejectionMessages(UpdateUserDto, { roleIds: [2] })).toContain('property roleIds should not exist');
      expect(await rejectionMessages(UpdateUserDto, { roleId: 2 })).toContain('property roleId should not exist');
      expect(await rejectionMessages(UpdateUserDto, { firstName: 'Renamed', roleIds: [] })).toContain('property roleIds should not exist');
    });

    it('still validates the profile fields it does accept', async () => {
      expect((await rejectionMessages(UpdateUserDto, { email: 'not-an-email' })).join(' ')).toMatch(/email/);
    });
  });

  describe('AddUserRolesDto', () => {
    it('accepts a non-empty list of unique positive integer ids', async () => {
      await expect(validate(AddUserRolesDto, { roleIds: [3] })).resolves.toMatchObject({ roleIds: [3] });
      await expect(validate(AddUserRolesDto, { roleIds: [3, 9, 4] })).resolves.toMatchObject({ roleIds: [3, 9, 4] });
    });

    it('is required and must be a non-empty array', async () => {
      expect((await rejectionMessages(AddUserRolesDto, {})).join(' ')).toMatch(/roleIds/);
      expect(await rejectionMessages(AddUserRolesDto, { roleIds: [] })).toContain('roleIds should not be empty');
      expect(await rejectionMessages(AddUserRolesDto, { roleIds: 3 })).toContain('roleIds must be an array');
    });

    it('rejects duplicates, non-integers and non-positive ids', async () => {
      expect((await rejectionMessages(AddUserRolesDto, { roleIds: [3, 3] })).join(' ')).toMatch(/unique/);
      expect((await rejectionMessages(AddUserRolesDto, { roleIds: ['3'] })).join(' ')).toMatch(/must be an integer number/);
      expect((await rejectionMessages(AddUserRolesDto, { roleIds: [2.5] })).join(' ')).toMatch(/must be an integer number/);
      expect((await rejectionMessages(AddUserRolesDto, { roleIds: [0] })).join(' ')).toMatch(/must not be less than 1/);
    });

    it('rejects any other property', async () => {
      expect(await rejectionMessages(AddUserRolesDto, { roleIds: [3], userId: 1 })).toContain('property userId should not exist');
    });
  });
});

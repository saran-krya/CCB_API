import { ForbiddenException, INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { SUPER_ADMIN_ASSIGN_MESSAGE, SUPER_ADMIN_MODIFY_MESSAGE } from '../../common/security/actor';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { UserController } from './user.controller';
import { UserService } from './user.service';

// HTTP-level tests for UserController's multi-role surface, through the real Nest HTTP stack: URI
// versioning, the global ValidationPipe with the exact options main.ts installs, ParseIntPipe, the
// exception filter and the response envelope — only UserService is a stub. What this adds over the
// service specs is what only a real request can prove: that the new routes are reachable, that they do
// not shadow (or get shadowed by) the existing static `GET profile / reporting-managers /
// field-inspectors` and `:id` routes, that the authenticated principal's id reaches the service as the
// actor, and that a stale client sending the old single `roleId` is answered with a 400. (Route
// authorization — @Permission — is guard metadata, covered in user-controller-permission.spec.ts.)
// Every write receives an `Actor` built from the authenticated principal's LIVE role names — never from
// anything in the request body — which is what lets the services refuse a non-SUPER_ADMIN touching SUPER_ADMIN.
describe('UserController over HTTP — role assignment routes and route ordering', () => {
  // The authenticated principal JwtStrategy would attach: the live role set rides on roleIds/roleNames.
  const PRINCIPAL = { sub: 9, email: 'admin@ccb.local', roleId: 1, roleName: 'SUPER_ADMIN', roleIds: [1], roleNames: ['SUPER_ADMIN'], type: 'staff' };
  let principal: Record<string, unknown> = PRINCIPAL;
  const ACTOR = { sub: PRINCIPAL.sub };
  /** What the controller must hand the service for the current principal. */
  const ACTOR_OF = (roleNames: string[], id: number = PRINCIPAL.sub) => ({ kind: 'user', id, roleNames });
  const SUPER_ADMIN_ACTOR = ACTOR_OF(['SUPER_ADMIN']);
  const SERVICE_METHODS = [
    'create',
    'findAll',
    'getProfile',
    'getReportingManagers',
    'getFieldInspectors',
    'updateOwnPreferences',
    'findOne',
    'update',
    'remove',
    'addRoles',
    'removeRole',
  ] as const;

  let app: INestApplication;
  let baseUrl: string;
  const users = Object.fromEntries(SERVICE_METHODS.map((method) => [method, jest.fn()])) as Record<
    (typeof SERVICE_METHODS)[number],
    jest.Mock
  >;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: users }],
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts's global setup, so the routes are exercised exactly as deployed.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    // Stands in for JwtAuthGuard, which is what puts the authenticated principal on the request.
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = principal;
      next();
    });

    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    Object.values(users).forEach((fn) => fn.mockReset());
    principal = PRINCIPAL;
  });

  async function http(method: string, path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  const ROLES_AFTER = [
    { id: 2, roleName: 'ADMIN' },
    { id: 3, roleName: 'OPERATIONS' },
  ];

  describe('POST /v1/users/:id/roles', () => {
    it('hands the path id, the validated roleIds and the authenticated actor to UserService.addRoles, and returns its roles array in the response envelope', async () => {
      users.addRoles.mockResolvedValue(ROLES_AFTER);

      const res = await http('POST', '/v1/users/5/roles', { roleIds: [2, 3] });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, message: 'Success', data: ROLES_AFTER });
      expect(users.addRoles).toHaveBeenCalledTimes(1);
      expect(users.addRoles).toHaveBeenCalledWith(5, [2, 3], SUPER_ADMIN_ACTOR);
    });

    it.each([
      ['no body', {}],
      ['an empty roleIds', { roleIds: [] }],
      ['duplicate ids', { roleIds: [2, 2] }],
      ['a non-integer id', { roleIds: [2.5] }],
      ['a numeric-string id', { roleIds: ['2'] }],
      ['a non-positive id', { roleIds: [0] }],
      ['an extra property', { roleIds: [2], userId: 1 }],
    ])('answers %s with a 400 and never reaches the service', async (_label, body) => {
      const res = await http('POST', '/v1/users/5/roles', body);

      expect(res.status).toBe(400);
      expect(users.addRoles).not.toHaveBeenCalled();
    });

    it('answers a non-numeric user id with a 400 (the id must be an integer) and never reaches the service', async () => {
      const res = await http('POST', '/v1/users/abc/roles', { roleIds: [2] });

      expect(res.status).toBe(400);
      expect(users.addRoles).not.toHaveBeenCalled();
    });

    it("surfaces the service's 403 refusal as a 403 with its exact message", async () => {
      users.addRoles.mockRejectedValue(new ForbiddenException('You cannot change your own roles.'));

      const res = await http('POST', '/v1/users/9/roles', { roleIds: [2] });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You cannot change your own roles.');
    });
  });

  describe('DELETE /v1/users/:id/roles/:roleId', () => {
    it('hands both path ids and the authenticated actor to UserService.removeRole, and returns its roles array in the response envelope', async () => {
      users.removeRole.mockResolvedValue(ROLES_AFTER);

      const res = await http('DELETE', '/v1/users/5/roles/3');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Success', data: ROLES_AFTER });
      expect(users.removeRole).toHaveBeenCalledTimes(1);
      expect(users.removeRole).toHaveBeenCalledWith(5, 3, SUPER_ADMIN_ACTOR);
    });

    it('is not mistaken for DELETE /v1/users/:id — the plain user delete is a different route and is not triggered', async () => {
      users.removeRole.mockResolvedValue(ROLES_AFTER);

      await http('DELETE', '/v1/users/5/roles/3');

      expect(users.remove).not.toHaveBeenCalled();
    });

    it('DELETE /v1/users/:id still reaches UserService.remove, not removeRole', async () => {
      users.remove.mockResolvedValue(undefined);

      const res = await http('DELETE', '/v1/users/5');

      expect(res.status).toBe(200);
      expect(users.remove).toHaveBeenCalledWith(5, SUPER_ADMIN_ACTOR);
      expect(users.removeRole).not.toHaveBeenCalled();
    });

    it.each([
      ['/v1/users/abc/roles/3', 'a non-numeric user id'],
      ['/v1/users/5/roles/abc', 'a non-numeric role id'],
    ])('answers %s (%s) with a 400 and never reaches the service', async (path) => {
      const res = await http('DELETE', path);

      expect(res.status).toBe(400);
      expect(users.removeRole).not.toHaveBeenCalled();
    });

    it.each([
      ['A user must hold at least one role.'],
      ['Cannot remove the last active SUPER_ADMIN — at least one active user must hold this role.'],
      [SUPER_ADMIN_MODIFY_MESSAGE],
      ['You cannot change your own roles.'],
    ])("surfaces the service's 403 refusal as a 403 with its exact message: %s", async (message) => {
      users.removeRole.mockRejectedValue(new ForbiddenException(message));

      const res = await http('DELETE', '/v1/users/5/roles/3');

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(message);
    });
  });

  describe('the old single-role surface is gone', () => {
    it('PATCH /v1/users/:id answers a body with the stale `roleId` — or any role field — with a 400, and update is never called', async () => {
      for (const body of [{ roleId: 2 }, { roleIds: [2] }, { firstName: 'Renamed', roleId: 2 }]) {
        const res = await http('PATCH', '/v1/users/5', body);

        expect(res.status).toBe(400);
      }
      expect(users.update).not.toHaveBeenCalled();
    });

    it('PATCH /v1/users/:id still accepts an ordinary profile edit, with the authenticated actor', async () => {
      users.update.mockResolvedValue({ id: 5, firstName: 'Renamed' });

      const res = await http('PATCH', '/v1/users/5', { firstName: 'Renamed' });

      expect(res.status).toBe(200);
      expect(users.update).toHaveBeenCalledWith(5, expect.objectContaining({ firstName: 'Renamed' }), SUPER_ADMIN_ACTOR);
    });

    it('POST /v1/users answers the stale single `roleId` with a 400 — roleIds is required instead', async () => {
      const profile = { firstName: 'New', lastName: 'Hire', email: 'new.hire@example.com' };

      const stale = await http('POST', '/v1/users', { ...profile, roleId: 2 });
      expect(stale.status).toBe(400);
      expect(users.create).not.toHaveBeenCalled();

      users.create.mockResolvedValue({ id: 77 });
      const current = await http('POST', '/v1/users', { ...profile, roleIds: [2, 3] });
      expect(current.status).toBe(201);
      expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ roleIds: [2, 3] }), SUPER_ADMIN_ACTOR);
    });
  });

  describe('SUPER_ADMIN protections are enforced by the services, whatever the client sends', () => {
    it("hands the service an Actor built from the principal's LIVE role names — a delegated administrator is NOT a SUPER_ADMIN actor", async () => {
      principal = { ...PRINCIPAL, sub: 12, roleId: 4, roleName: 'USER_MANAGER', roleIds: [4], roleNames: ['USER_MANAGER'] };
      users.addRoles.mockResolvedValue(ROLES_AFTER);
      users.create.mockResolvedValue({ id: 77 });
      users.update.mockResolvedValue({ id: 5 });
      users.remove.mockResolvedValue(undefined);
      users.removeRole.mockResolvedValue(ROLES_AFTER);
      const delegated = ACTOR_OF(['USER_MANAGER'], 12);

      await http('POST', '/v1/users/5/roles', { roleIds: [2] });
      await http('DELETE', '/v1/users/5/roles/2');
      await http('POST', '/v1/users', { firstName: 'N', lastName: 'H', email: 'n.h@example.com', roleIds: [2] });
      await http('PATCH', '/v1/users/5', { firstName: 'X' });
      await http('DELETE', '/v1/users/5');

      expect(users.addRoles).toHaveBeenCalledWith(5, [2], delegated);
      expect(users.removeRole).toHaveBeenCalledWith(5, 2, delegated);
      expect(users.create).toHaveBeenCalledWith(expect.anything(), delegated);
      expect(users.update).toHaveBeenCalledWith(5, expect.anything(), delegated);
      expect(users.remove).toHaveBeenCalledWith(5, delegated);
    });

    it('a principal without a role-name list falls back to its single live role name', async () => {
      principal = { sub: 12, email: 'a@ccb.local', roleId: 4, roleName: 'USER_MANAGER', type: 'staff' };
      users.remove.mockResolvedValue(undefined);

      await http('DELETE', '/v1/users/5');

      expect(users.remove).toHaveBeenCalledWith(5, ACTOR_OF(['USER_MANAGER'], 12));
    });

    it('role names sent in the request body can never become the actor — they are rejected as unknown properties', async () => {
      const res = await http('POST', '/v1/users', {
        firstName: 'N',
        lastName: 'H',
        email: 'n.h@example.com',
        roleIds: [1],
        roleNames: ['SUPER_ADMIN'],
        actor: { kind: 'system' },
      });

      expect(res.status).toBe(400);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('surfaces the 403 "Only SUPER_ADMIN can assign the SUPER_ADMIN role." from create and from addRoles, with that exact message', async () => {
      users.create.mockRejectedValue(new ForbiddenException(SUPER_ADMIN_ASSIGN_MESSAGE));
      users.addRoles.mockRejectedValue(new ForbiddenException(SUPER_ADMIN_ASSIGN_MESSAGE));

      const created = await http('POST', '/v1/users', { firstName: 'N', lastName: 'H', email: 'n.h@example.com', roleIds: [1] });
      const granted = await http('POST', '/v1/users/5/roles', { roleIds: [1] });

      expect(created.status).toBe(403);
      expect(created.body.message).toBe(SUPER_ADMIN_ASSIGN_MESSAGE);
      expect(granted.status).toBe(403);
      expect(granted.body.message).toBe(SUPER_ADMIN_ASSIGN_MESSAGE);
    });

    it.each([
      ['edit', 'PATCH', '/v1/users/5', { firstName: 'X' }, 'update'],
      ['delete', 'DELETE', '/v1/users/5', undefined, 'remove'],
    ] as const)("surfaces the service's 403 when a non-SUPER_ADMIN tries to %s a SUPER_ADMIN account", async (_label, method, path, body, serviceMethod) => {
      users[serviceMethod].mockRejectedValue(new ForbiddenException(SUPER_ADMIN_MODIFY_MESSAGE));

      const res = await http(method, path, body);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(SUPER_ADMIN_MODIFY_MESSAGE);
    });

    it('surfaces the self-delete and self-deactivate refusals as 403s', async () => {
      users.remove.mockRejectedValue(new ForbiddenException('You cannot delete your own account.'));
      users.update.mockRejectedValue(new ForbiddenException('You cannot deactivate your own account.'));

      const deleted = await http('DELETE', '/v1/users/9');
      const deactivated = await http('PATCH', '/v1/users/9', { active: false });

      expect(deleted.status).toBe(403);
      expect(deleted.body.message).toBe('You cannot delete your own account.');
      expect(deactivated.status).toBe(403);
      expect(deactivated.body.message).toBe('You cannot deactivate your own account.');
    });
  });

  describe('passwords — the policy applies on create, and update cannot carry one', () => {
    const profile = { firstName: 'New', lastName: 'Hire', email: 'new.hire@example.com', roleIds: [2] };

    it.each([
      ['too short', 'Aa1!aaaa'],
      ['a single character type', 'abcdefghijklmnop'],
      ['one repeated character', 'aaaaaaaaaaaaaaaa'],
      ['over the maximum length', 'Aa1!' + 'x'.repeat(130)],
    ])('POST /v1/users answers a password that is %s with a 400 and never reaches the service', async (_label, password) => {
      const res = await http('POST', '/v1/users', { ...profile, password });

      expect(res.status).toBe(400);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('POST /v1/users accepts a password that meets the policy', async () => {
      users.create.mockResolvedValue({ id: 77 });

      const res = await http('POST', '/v1/users', { ...profile, password: 'Correct-Horse-9-Battery' });

      expect(res.status).toBe(201);
      expect(users.create).toHaveBeenCalledTimes(1);
    });

    it('PATCH /v1/users/:id answers a body carrying a password — or a hash — with a 400: a password is never changed through update', async () => {
      for (const body of [{ password: 'Correct-Horse-9-Battery' }, { passwordHash: '$2a$12$abc' }, { firstName: 'X', password: 'Correct-Horse-9-Battery' }]) {
        const res = await http('PATCH', '/v1/users/5', body);

        expect(res.status).toBe(400);
      }
      expect(users.update).not.toHaveBeenCalled();
    });
  });

  describe('route ordering — the new /roles routes neither shadow nor are shadowed by the existing ones', () => {
    it('the static GET routes still win over GET /:id', async () => {
      users.getProfile.mockResolvedValue({ id: ACTOR.sub });
      users.getReportingManagers.mockResolvedValue([]);
      users.getFieldInspectors.mockResolvedValue([]);

      expect((await http('GET', '/v1/users/profile')).status).toBe(200);
      expect((await http('GET', '/v1/users/reporting-managers')).status).toBe(200);
      expect((await http('GET', '/v1/users/field-inspectors')).status).toBe(200);

      expect(users.getProfile).toHaveBeenCalledWith(ACTOR.sub);
      expect(users.getReportingManagers).toHaveBeenCalledTimes(1);
      expect(users.getFieldInspectors).toHaveBeenCalledTimes(1);
      expect(users.findOne).not.toHaveBeenCalled();
    });

    it('GET /v1/users/:id still reaches findOne, which now carries role and roles', async () => {
      users.findOne.mockResolvedValue({ id: 7, role: ROLES_AFTER[0], roles: ROLES_AFTER });

      const res = await http('GET', '/v1/users/7');

      expect(res.status).toBe(200);
      expect(users.findOne).toHaveBeenCalledWith(7);
      expect(res.body.data).toEqual({ id: 7, role: ROLES_AFTER[0], roles: ROLES_AFTER });
    });

    it('PATCH /v1/users/me/preferences is untouched by the new routes', async () => {
      users.updateOwnPreferences.mockResolvedValue({ themeMode: 'dark' });

      const res = await http('PATCH', '/v1/users/me/preferences', { themeMode: 'dark' });

      expect(res.status).toBe(200);
      expect(users.updateOwnPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ sub: ACTOR.sub }),
        expect.objectContaining({ themeMode: 'dark' }),
      );
      expect(users.update).not.toHaveBeenCalled();
    });

    it('a GET on the roles path is not a route', async () => {
      const res = await http('GET', '/v1/users/5/roles');

      expect(res.status).toBe(404);
    });
  });
});

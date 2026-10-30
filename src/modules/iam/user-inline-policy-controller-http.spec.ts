import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserInlinePolicyController } from './user-inline-policy.controller';
import { UserInlinePolicyService } from './user-inline-policy.service';

// HTTP-level tests for the inline-policy routes through the real Nest HTTP stack (URI versioning, the
// global ValidationPipe with the exact options main.ts installs, ParseIntPipe, exception filter,
// response envelope) — only the service is a stub. Route AUTHORIZATION is guard metadata: the whole
// controller must be SUPER_ADMIN-only (same boundary as Policy Management), which is asserted here
// against the real @Roles metadata.
describe('UserInlinePolicyController over HTTP', () => {
  const ACTOR = { sub: 9, email: 'root@ccb.local', roleId: 1, roleName: 'SUPER_ADMIN', type: 'staff' };
  const VALID_BODY = { name: 'Temp tariff access', statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] }] };

  let app: INestApplication;
  let baseUrl: string;
  const service = { findAllForUser: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserInlinePolicyController],
      providers: [{ provide: UserInlinePolicyService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
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
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = ACTOR;
      next();
    });

    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset());
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  it('is SUPER_ADMIN-only: the controller carries @Roles(SUPER_ADMIN), the same boundary as Policy Management', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UserInlinePolicyController)).toEqual(['SUPER_ADMIN']);
  });

  it('POST creates for the user in the URL, handing the service the authenticated principal id as the actor', async () => {
    service.create.mockResolvedValue({ id: 1, name: VALID_BODY.name });

    const { status, json } = await call('POST', '/users/42/inline-policies', VALID_BODY);

    expect(status).toBe(201);
    expect(json.data).toEqual({ id: 1, name: VALID_BODY.name });
    expect(service.create).toHaveBeenCalledWith(42, expect.objectContaining(VALID_BODY), 9);
  });

  it.each([
    ['no statements', { name: 'X', statements: [] }],
    ['no name', { statements: VALID_BODY.statements }],
    ['a statement with no actions', { name: 'X', statements: [{ resourceCode: 'TARIFF', actionCodes: [] }] }],
    ['an unknown field (forbidNonWhitelisted)', { ...VALID_BODY, isSystem: true }],
    ['a name longer than 150 characters', { ...VALID_BODY, name: 'x'.repeat(151) }],
  ])('POST with %s is a 400 and never reaches the service', async (_label, body) => {
    const { status } = await call('POST', '/users/42/inline-policies', body);

    expect(status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('a non-integer user id is a 400, not a lookup', async () => {
    const { status } = await call('GET', '/users/abc/inline-policies');

    expect(status).toBe(400);
    expect(service.findAllForUser).not.toHaveBeenCalled();
  });

  it("GET lists that user's inline policies", async () => {
    service.findAllForUser.mockResolvedValue([{ id: 1, name: 'A', statements: [] }]);

    const { status, json } = await call('GET', '/users/42/inline-policies');

    expect(status).toBe(200);
    expect(json.data).toEqual([{ id: 1, name: 'A', statements: [] }]);
    expect(service.findAllForUser).toHaveBeenCalledWith(42);
  });

  it('GET /:policyId returns one policy of that user', async () => {
    service.findOne.mockResolvedValue({ id: 7, name: 'A', statements: [] });

    const { status, json } = await call('GET', '/users/42/inline-policies/7');

    expect(status).toBe(200);
    expect(json.data).toEqual({ id: 7, name: 'A', statements: [] });
    expect(service.findOne).toHaveBeenCalledWith(42, 7);
  });

  it('GET /:policyId with a non-integer policy id is a 400', async () => {
    const { status } = await call('GET', '/users/42/inline-policies/x');

    expect(status).toBe(400);
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('PATCH replaces the policy of that user, handing the service the authenticated principal id as the actor', async () => {
    service.update.mockResolvedValue({ id: 7, name: VALID_BODY.name });

    const { status, json } = await call('PATCH', '/users/42/inline-policies/7', VALID_BODY);

    expect(status).toBe(200);
    expect(json.data).toEqual({ id: 7, name: VALID_BODY.name });
    expect(service.update).toHaveBeenCalledWith(42, 7, expect.objectContaining(VALID_BODY), 9);
  });

  it.each([
    ['no statements', { name: 'X', statements: [] }],
    ['no name', { statements: VALID_BODY.statements }],
    ['a statement with no actions', { name: 'X', statements: [{ resourceCode: 'TARIFF', actionCodes: [] }] }],
    ['an unknown field (forbidNonWhitelisted)', { ...VALID_BODY, userId: 1 }],
    ['a name longer than 150 characters', { ...VALID_BODY, name: 'x'.repeat(151) }],
    ['a description longer than 500 characters', { ...VALID_BODY, description: 'x'.repeat(501) }],
  ])('PATCH with %s is a 400 and never reaches the service', async (_label, body) => {
    const { status } = await call('PATCH', '/users/42/inline-policies/7', body);

    expect(status).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('PATCH with a non-integer user or policy id is a 400', async () => {
    expect((await call('PATCH', '/users/abc/inline-policies/7', VALID_BODY)).status).toBe(400);
    expect((await call('PATCH', '/users/42/inline-policies/x', VALID_BODY)).status).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('DELETE removes one policy of that user, with the actor id', async () => {
    service.remove.mockResolvedValue({ message: 'Inline policy deleted' });

    const { status, json } = await call('DELETE', '/users/42/inline-policies/7');

    expect(status).toBe(200);
    expect(json.data).toEqual({ message: 'Inline policy deleted' });
    expect(service.remove).toHaveBeenCalledWith(42, 7, 9);
  });

  it('DELETE with a non-integer policy id is a 400', async () => {
    const { status } = await call('DELETE', '/users/42/inline-policies/x');

    expect(status).toBe(400);
    expect(service.remove).not.toHaveBeenCalled();
  });
});

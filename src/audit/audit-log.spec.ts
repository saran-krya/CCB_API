import { BadRequestException, ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditLogController } from './audit-log.controller';
import { AUDIT_FILTER_OPTIONS_TTL_MS, AuditLogQueryService, MAX_RECENT_AUDIT_ENTRIES } from './audit-log-query.service';
import { AUDIT_REDACTED_VALUE, humanizeAuditToken, parseAuditValue } from './audit-log.util';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

describe('audit-log.util', () => {
  describe('humanizeAuditToken', () => {
    it.each([
      ['BillRun', 'Bill Run'],
      ['MeterReading', 'Meter Reading'],
      ['billing_cycles', 'Billing Cycles'],
      ['BILLING_MANAGEMENT', 'Billing Management'],
      ['registration-requests', 'Registration Requests'],
      ['ADMIN_RESET_PASSWORD', 'Admin Reset Password'],
      ['CREATE', 'Create'],
    ])('%s -> %s', (raw, label) => {
      expect(humanizeAuditToken(raw)).toBe(label);
    });
  });

  describe('parseAuditValue', () => {
    it('is null for a missing value', () => {
      expect(parseAuditValue(null)).toBeNull();
      expect(parseAuditValue(undefined)).toBeNull();
    });

    it('parses the JSON a writer stored', () => {
      expect(parseAuditValue('{"name":"Role A","active":true}')).toEqual({ name: 'Role A', active: true });
    });

    it('returns text that is not JSON as it is', () => {
      expect(parseAuditValue('plain note')).toBe('plain note');
    });

    it('masks secret-looking STRING values at any depth, in arrays too, and nothing else', () => {
      const stored = JSON.stringify({
        email: 'a@b.c',
        passwordHash: '$2b$10$abc',
        mustChangePassword: true,
        nested: { refreshToken: 'tok', list: [{ apiKey: 'k1', label: 'ok' }] },
        otp: '123456',
        emptySecret: '',
      });

      expect(parseAuditValue(stored)).toEqual({
        email: 'a@b.c',
        passwordHash: AUDIT_REDACTED_VALUE,
        mustChangePassword: true, // a boolean fact, not a secret
        nested: { refreshToken: AUDIT_REDACTED_VALUE, list: [{ apiKey: AUDIT_REDACTED_VALUE, label: 'ok' }] },
        otp: AUDIT_REDACTED_VALUE,
        emptySecret: '',
      });
    });
  });
});

/** A chainable stand-in for TypeORM's SelectQueryBuilder that records what the service asked of it. */
function fakeQueryBuilder(result: { rows?: unknown[]; row?: unknown; count?: number; distinct?: Record<string, { value: string }[]> }) {
  const calls: { andWhere: [string, Record<string, unknown>?][]; where: [string, Record<string, unknown>?][]; orderBy: unknown[][]; select: unknown[][]; offset?: number; limit?: number } = {
    andWhere: [],
    where: [],
    orderBy: [],
    select: [],
  };
  let selected = '';
  const qb: Record<string, unknown> = {
    calls,
    withDeleted: () => qb,
    leftJoin: () => qb,
    select: (expr: string, alias?: string) => {
      selected = expr;
      calls.select.push([expr, alias]);
      return qb;
    },
    addSelect: (expr: string, alias?: string) => {
      calls.select.push([expr, alias]);
      return qb;
    },
    where: (sql: string, params?: Record<string, unknown>) => {
      calls.where.push([sql, params]);
      return qb;
    },
    andWhere: (sql: string, params?: Record<string, unknown>) => {
      calls.andWhere.push([sql, params]);
      return qb;
    },
    orderBy: (...args: unknown[]) => {
      calls.orderBy.push(args);
      return qb;
    },
    addOrderBy: (...args: unknown[]) => {
      calls.orderBy.push(args);
      return qb;
    },
    offset: (n: number) => {
      calls.offset = n;
      return qb;
    },
    limit: (n: number) => {
      calls.limit = n;
      return qb;
    },
    clone: () => qb,
    getCount: async () => result.count ?? 0,
    getRawOne: async () => result.row,
    getRawMany: async () => {
      if (selected.startsWith('DISTINCT')) return result.distinct?.[selected.replace('DISTINCT audit.', '')] ?? [];
      return result.rows ?? [];
    },
  };
  return qb as typeof qb & { calls: typeof calls };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  createdAt: new Date('2026-11-10T04:30:00.000Z'),
  moduleName: 'billing_cycles',
  action: 'UPDATE',
  entityId: 12,
  performedBy: 7,
  actorFirstName: 'Asha',
  actorLastName: 'Nair',
  actorEmail: 'asha@ccb.local',
  hasDetails: 1,
  ...overrides,
});

const query = (overrides: Partial<AuditLogQueryDto> = {}): AuditLogQueryDto => Object.assign(new AuditLogQueryDto(), overrides);

describe('AuditLogQueryService', () => {
  let builders: ReturnType<typeof fakeQueryBuilder>[];
  let result: Parameters<typeof fakeQueryBuilder>[0];
  let service: AuditLogQueryService;

  beforeEach(() => {
    builders = [];
    result = {
      rows: [row()],
      count: 41,
      distinct: { moduleName: [{ value: 'billing_cycles' }, { value: 'BillRun' }], action: [{ value: 'UPDATE' }, { value: 'ADMIN_RESET_PASSWORD' }] },
    };
    const repo = {
      createQueryBuilder: jest.fn(() => {
        const qb = fakeQueryBuilder(result);
        builders.push(qb);
        return qb;
      }),
    };
    service = new AuditLogQueryService(repo as never);
  });

  afterEach(() => jest.restoreAllMocks());

  /** The builder that produced the page of rows (the first one created; the others are the filter-option queries). */
  const pageBuilder = () => builders[0];

  describe('list', () => {
    it('returns the newest entries first by default, with a stable id tie-break, and the pagination block', async () => {
      const response = await service.list(query({ page: 3, limit: 10 }));

      expect(pageBuilder().calls.orderBy).toEqual([
        ['audit.createdAt', 'DESC'],
        ['audit.id', 'DESC'],
      ]);
      expect(pageBuilder().calls.offset).toBe(20);
      expect(pageBuilder().calls.limit).toBe(10);
      expect(response.pagination).toEqual({ page: 3, limit: 10, total: 41, totalPages: 5 });
    });

    it('maps a row: ISO timestamp, readable labels, the actor, and whether there is anything to open', async () => {
      const { items } = await service.list(query());

      expect(items).toEqual([
        {
          id: 5,
          createdAt: '2026-11-10T04:30:00.000Z',
          moduleName: 'billing_cycles',
          moduleLabel: 'Billing Cycles',
          action: 'UPDATE',
          actionLabel: 'Update',
          entityId: 12,
          performedBy: { id: 7, name: 'Asha Nair', email: 'asha@ccb.local' },
          hasDetails: true,
        },
      ]);
    });

    it('shows no actor for a system entry, the email when the account has no name, and a null name for a vanished account', async () => {
      result.rows = [
        row({ id: 1, performedBy: null, actorFirstName: null, actorLastName: null, actorEmail: null, entityId: null, hasDetails: 0 }),
        row({ id: 2, actorFirstName: null, actorLastName: null }),
        row({ id: 3, actorFirstName: null, actorLastName: null, actorEmail: null }),
      ];

      const { items } = await service.list(query());

      expect(items[0]).toMatchObject({ performedBy: null, entityId: null, hasDetails: false });
      expect(items[1].performedBy).toEqual({ id: 7, name: 'asha@ccb.local', email: 'asha@ccb.local' });
      expect(items[2].performedBy).toEqual({ id: 7, name: null, email: null });
    });

    it('applies each exact-match filter as a bound parameter', async () => {
      await service.list(query({ moduleName: 'roles', action: 'DELETE', performedBy: 7, entityId: 99 }));

      expect(pageBuilder().calls.andWhere).toEqual([
        ['audit.moduleName = :moduleName', { moduleName: 'roles' }],
        ['audit.action = :action', { action: 'DELETE' }],
        ['audit.performedBy = :performedBy', { performedBy: 7 }],
        ['audit.entityId = :entityId', { entityId: 99 }],
      ]);
    });

    it('includes the whole "to" day: from = local midnight of the first day, to = local midnight AFTER the last day', async () => {
      await service.list(query({ dateFrom: '2026-11-01', dateTo: '2026-11-10' }));

      const params = Object.assign({}, ...pageBuilder().calls.andWhere.map(([, p]) => p));
      expect(params.dateFrom).toEqual(new Date(2026, 10, 1));
      expect(params.dateToExclusive).toEqual(new Date(2026, 10, 11));
    });

    it('rolls "to" over a month end correctly', async () => {
      await service.list(query({ dateTo: '2026-12-31' }));

      const params = Object.assign({}, ...pageBuilder().calls.andWhere.map(([, p]) => p));
      expect(params.dateToExclusive).toEqual(new Date(2027, 0, 1));
    });

    it('rejects a date that does not exist on the calendar, and a reversed range', async () => {
      await expect(service.list(query({ dateFrom: '2026-02-31' }))).rejects.toThrow(BadRequestException);
      await expect(service.list(query({ dateTo: '2026-13-01' }))).rejects.toThrow(BadRequestException);
      await expect(service.list(query({ dateFrom: '2026-11-10', dateTo: '2026-11-01' }))).rejects.toThrow(/must not be after/);
    });

    it('requires EVERY searched word to match somewhere, with LIKE wildcards in the text escaped', async () => {
      await service.list(query({ search: 'asha 100%' }));

      const searches = pageBuilder().calls.andWhere;
      expect(searches).toHaveLength(2);
      expect(searches[0][0]).toContain('audit.action LIKE :auditSearch0');
      expect(searches[0][0]).toContain('actor.email LIKE :auditSearch0');
      expect(searches[0][1]).toEqual({ auditSearch0: '%asha%' });
      expect(searches[1][1]).toEqual({ auditSearch1: '%100\\%%' });
    });

    it('ignores a blank search but refuses an over-long one', async () => {
      await service.list(query({ search: '   ' }));
      expect(pageBuilder().calls.andWhere).toHaveLength(0);

      await expect(service.list(query({ search: 'x'.repeat(101) }))).rejects.toThrow(/too long/);
    });

    it('sorts by only the allowed columns, ascending when asked', async () => {
      await service.list(query({ sortBy: 'moduleName', sortOrder: 'ASC' }));

      expect(pageBuilder().calls.orderBy[0]).toEqual(['audit.moduleName', 'ASC']);
    });

    it('lists every module and action present in the trail with readable labels, and reuses them for a minute', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

      const first = await service.list(query());
      expect(first.meta).toEqual({
        modules: [
          { value: 'billing_cycles', label: 'Billing Cycles' },
          { value: 'BillRun', label: 'Bill Run' },
        ],
        actions: [
          { value: 'UPDATE', label: 'Update' },
          { value: 'ADMIN_RESET_PASSWORD', label: 'Admin Reset Password' },
        ],
      });
      const created = builders.length;

      now.mockReturnValue(1_000_000 + AUDIT_FILTER_OPTIONS_TTL_MS - 1);
      await service.list(query());
      expect(builders.length).toBe(created + 1); // only the page query — options came from the cache

      now.mockReturnValue(1_000_000 + AUDIT_FILTER_OPTIONS_TTL_MS + 1);
      await service.list(query());
      expect(builders.length).toBe(created + 1 + 3); // page + two fresh DISTINCT queries
    });
  });

  describe('recent', () => {
    it('returns the newest entries and never more than the cap', async () => {
      await service.recent(10_000);

      expect(pageBuilder().calls.limit).toBe(MAX_RECENT_AUDIT_ENTRIES);
      expect(pageBuilder().calls.orderBy[0]).toEqual(['audit.createdAt', 'DESC']);
    });

    it('asks for at least one', async () => {
      await service.recent(0);
      expect(pageBuilder().calls.limit).toBe(1);
    });
  });

  describe('findOne', () => {
    it('returns the entry with its old and new values parsed and secret-looking values masked', async () => {
      result.row = row({ oldValue: '{"active":true}', newValue: '{"active":false,"passwordHash":"x"}' });

      const detail = await service.findOne(5);

      expect(pageBuilder().calls.where).toEqual([['audit.id = :id', { id: 5 }]]);
      expect(detail.oldValue).toEqual({ active: true });
      expect(detail.newValue).toEqual({ active: false, passwordHash: AUDIT_REDACTED_VALUE });
      expect(detail.moduleLabel).toBe('Billing Cycles');
    });

    it('is a 404 for an entry that does not exist', async () => {
      result.row = undefined;

      await expect(service.findOne(404)).rejects.toThrow(NotFoundException);
    });
  });
});

describe('AuditLogController access', () => {
  const guard = new RolesGuard(new Reflector());
  const contextFor = (handler: 'findAll' | 'findOne', user: unknown) =>
    ({
      getHandler: () => AuditLogController.prototype[handler],
      getClass: () => AuditLogController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it.each(['findAll', 'findOne'] as const)('%s admits a SUPER_ADMIN session', (handler) => {
    expect(guard.canActivate(contextFor(handler, { type: 'staff', roleName: 'SUPER_ADMIN', roleNames: ['SUPER_ADMIN'] }))).toBe(true);
  });

  it.each(['findAll', 'findOne'] as const)('%s refuses any other staff role, a customer, and an anonymous request', (handler) => {
    expect(guard.canActivate(contextFor(handler, { type: 'staff', roleName: 'AUDITOR', roleNames: ['AUDITOR'] }))).toBe(false);
    expect(guard.canActivate(contextFor(handler, { type: 'customer', sub: 1 }))).toBe(false);
    expect(guard.canActivate(contextFor(handler, undefined))).toBe(false);
  });

  it('exposes no route that writes: only GET handlers exist', () => {
    const handlers = Object.getOwnPropertyNames(AuditLogController.prototype).filter((name) => name !== 'constructor');
    expect(handlers.sort()).toEqual(['findAll', 'findOne']);
  });
});

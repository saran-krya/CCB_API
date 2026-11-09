import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { Organization, OrganizationStatus } from './entities/organization.entity';

// Covers what Phase B actually introduces: the validated status-lifecycle transitions and the
// duplicate-code guard. Full cross-tenant isolation tests (two real organizations, verifying one
// cannot see the other's data through any API) are deliberately deferred to Phase H — there is
// nothing yet for them to verify until Phase E's enforcement (OrganizationContextGuard + the
// query-filtering layer) actually exists; testing "isolation" before any filter exists would just be
// asserting that an unwritten feature is absent, not a real guarantee.
describe('OrganizationService', () => {
  let service: OrganizationService;
  let organizations: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let subscriptionPlans: { findOne: jest.Mock };
  let audit: { record: jest.Mock };

  const org = (overrides: Partial<Organization> = {}): Organization =>
    ({ id: 1, name: 'Azizi', code: 'AZD', status: OrganizationStatus.PENDING, ...overrides }) as Organization;

  beforeEach(() => {
    organizations = {
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn((v) => v),
      createQueryBuilder: jest.fn(),
    };
    subscriptionPlans = { findOne: jest.fn().mockResolvedValue({ id: 1, code: 'GROWTH' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new OrganizationService(organizations as any, subscriptionPlans as any, audit as any);
  });

  describe('create', () => {
    it('rejects a duplicate organization code', async () => {
      organizations.findOne.mockResolvedValue(org());
      await expect(
        service.create({ name: 'Azizi', code: 'AZD', primaryContactName: 'A', primaryContactEmail: 'a@x.com' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('always creates a new organization as PENDING, regardless of what the caller passes', async () => {
      organizations.findOne.mockResolvedValue(null);
      const created = await service.create({
        name: 'Azizi', code: 'AZD', primaryContactName: 'A', primaryContactEmail: 'a@x.com',
      } as any);
      expect(created.status).toBe(OrganizationStatus.PENDING);
      expect(audit.record).toHaveBeenCalled();
    });
  });

  describe('updateStatus — validated lifecycle transitions', () => {
    const run = async (from: OrganizationStatus, to: OrganizationStatus) => {
      organizations.findOne.mockResolvedValue(org({ status: from }));
      return service.updateStatus(1, { status: to } as any);
    };

    it.each([
      [OrganizationStatus.PENDING, OrganizationStatus.ACTIVE],
      [OrganizationStatus.PENDING, OrganizationStatus.INACTIVE],
      [OrganizationStatus.ACTIVE, OrganizationStatus.SUSPENDED],
      [OrganizationStatus.ACTIVE, OrganizationStatus.INACTIVE],
      [OrganizationStatus.SUSPENDED, OrganizationStatus.ACTIVE],
      [OrganizationStatus.SUSPENDED, OrganizationStatus.INACTIVE],
      [OrganizationStatus.INACTIVE, OrganizationStatus.ACTIVE],
    ])('allows %s -> %s', async (from, to) => {
      await expect(run(from, to)).resolves.toMatchObject({ status: to });
      expect(audit.record).toHaveBeenCalled();
    });

    it.each([
      [OrganizationStatus.PENDING, OrganizationStatus.SUSPENDED],
      [OrganizationStatus.SUSPENDED, OrganizationStatus.PENDING],
      [OrganizationStatus.INACTIVE, OrganizationStatus.SUSPENDED],
      [OrganizationStatus.INACTIVE, OrganizationStatus.PENDING],
      [OrganizationStatus.ACTIVE, OrganizationStatus.PENDING],
    ])('rejects %s -> %s', async (from, to) => {
      await expect(run(from, to)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a no-op "transition" to the same status', async () => {
      await expect(run(OrganizationStatus.ACTIVE, OrganizationStatus.ACTIVE)).resolves.toMatchObject({
        status: OrganizationStatus.ACTIVE,
      });
    });
  });

  describe('assignSubscription', () => {
    it('rejects an unknown subscription plan', async () => {
      organizations.findOne.mockResolvedValue(org());
      subscriptionPlans.findOne.mockRejectedValue(new Error('not found'));
      await expect(
        service.assignSubscription(1, { subscriptionPlanId: 999, subscriptionStartDate: '2026-01-01', subscriptionExpiryDate: '2027-01-01' } as any),
      ).rejects.toThrow();
    });

    it('records the old and new subscription in the audit trail', async () => {
      organizations.findOne.mockResolvedValue(org({ subscriptionPlanId: null, subscriptionExpiryDate: null } as any));
      await service.assignSubscription(1, {
        subscriptionPlanId: 1, subscriptionStartDate: '2026-01-01', subscriptionExpiryDate: '2027-01-01',
      } as any);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ oldValue: expect.objectContaining({ subscriptionPlanId: null }) }),
      );
    });
  });
});

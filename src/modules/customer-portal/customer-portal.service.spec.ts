import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerService } from '../customer/customer.service';
import { CommunityService } from '../community/community.service';
import { PropertyService } from '../property/property.service';
import { UnitService } from '../unit/unit.service';
import { MeterService } from '../meter/meter.service';
import { RegistrationRequestService } from '../registration-request/registration-request.service';
import { LovService } from '../lov/lov.service';
import { AttributeService } from '../attribute/attribute.service';
import { BillingManagementService } from '../billing-management/billing-management.service';

// Isolated unit tests for CustomerPortalService.getMyInvoices/getMyInvoice — the fix for a
// confirmed real gap: no backend route was reachable by a customer token to view their own
// generated Bills at all (BillingManagementController's own routes are @Permission-gated, and
// PermissionGuard unconditionally denies any user.type === 'customer'). These two methods reuse
// BillingManagementService.findAll/findOne exactly as the staff Manage Invoices screen does —
// never a second, parallel Bill query — adding only the ownership-scoping layer verified here.
describe('CustomerPortalService customer invoice visibility', () => {
  let service: CustomerPortalService;
  let billingManagement: { findAll: jest.Mock; findOne: jest.Mock };

  const OWN_BILL = { id: 50, customerId: 66, unitId: 2048, billRunId: 7, status: 'generated' };
  const OTHER_CUSTOMERS_BILL = { id: 51, customerId: 99, unitId: 3001, billRunId: 8, status: 'generated' };

  beforeEach(async () => {
    billingManagement = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerPortalService,
        { provide: CustomerService, useValue: {} },
        { provide: CommunityService, useValue: {} },
        { provide: PropertyService, useValue: {} },
        { provide: UnitService, useValue: {} },
        { provide: MeterService, useValue: {} },
        { provide: RegistrationRequestService, useValue: {} },
        { provide: LovService, useValue: {} },
        { provide: AttributeService, useValue: {} },
        { provide: BillingManagementService, useValue: billingManagement },
      ],
    }).compile();

    service = moduleRef.get(CustomerPortalService);
  });

  describe('getMyInvoices', () => {
    it('forces customerId into the query, reusing BillingManagementService.findAll exactly as the staff screen does', async () => {
      billingManagement.findAll.mockResolvedValue({ items: [OWN_BILL], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });

      const result = await service.getMyInvoices(66, { status: 'generated' } as any);

      expect(billingManagement.findAll).toHaveBeenCalledWith({ status: 'generated', customerId: 66 });
      expect(result.items).toEqual([OWN_BILL]);
    });

    it('a client-supplied customerId on the incoming query can never override the authenticated session — forced customerId always wins', async () => {
      billingManagement.findAll.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

      await service.getMyInvoices(66, { customerId: 999 } as any);

      expect(billingManagement.findAll).toHaveBeenCalledWith(expect.objectContaining({ customerId: 66 }));
    });
  });

  describe('getMyInvoice', () => {
    it('returns the bill when it belongs to the requesting customer', async () => {
      billingManagement.findOne.mockResolvedValue(OWN_BILL);

      const result = await service.getMyInvoice(66, 50);

      expect(billingManagement.findOne).toHaveBeenCalledWith(50);
      expect(result).toEqual(OWN_BILL);
    });

    it('throws ForbiddenException when the bill belongs to a different customer — the one check standing between "my own invoice" and "any invoice by guessing an id"', async () => {
      billingManagement.findOne.mockResolvedValue(OTHER_CUSTOMERS_BILL);

      await expect(service.getMyInvoice(66, 51)).rejects.toThrow(ForbiddenException);
    });

    it('a different customer requesting the same bill id is rejected, even though the id itself is valid and exists', async () => {
      billingManagement.findOne.mockResolvedValue(OWN_BILL);

      await expect(service.getMyInvoice(99, 50)).rejects.toThrow(ForbiddenException);
    });
  });
});

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BillingManagementService } from './billing-management.service';
import { Bill } from './entities/bill.entity';
import { BillLineItem } from './entities/bill-line-item.entity';
import { BillRun, BillRunStatus } from '../bill-run/entities/bill-run.entity';
import { Unit, UnitStatus } from '../unit/entities/unit.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { TariffTier } from '../tariff/entities/tariff-tier.entity';
import { TariffRateType } from '../tariff/entities/tariff-version.entity';
import { TariffService } from '../tariff/tariff.service';
import { CustomerService } from '../customer/customer.service';
import { AuditService } from '../../audit/audit.service';

// Isolated unit test for generateBillsForBillRun's tariff-resolver branch only — proves
// billRun.tariffResolutionDate correctly routes to TariffService.resolveForUnitsAsOf (Missed
// Reading Recovery) vs the routine resolveForUnits, and never silently passes an 'ambiguous'
// result through as if it were a resolved TariffVersion. Every dependency mocked; this does not
// re-test tariff-rate calculation itself, which is unrelated to this feature and already has no
// changed logic.

function qbStub(readingRows: { readingValue: string }[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(readingRows),
  };
}

const FLAT_TARIFF = {
  id: 26,
  rateType: TariffRateType.FLAT,
  flatRate: '0.50',
  billingServiceFee: '0',
  vat: '0',
  vatApplicableFees: [],
} as any;

const ONE_UNIT = { id: 2050, status: UnitStatus.ACTIVE } as unknown as Unit;

describe('BillingManagementService.generateBillsForBillRun — tariff resolver branch', () => {
  let service: BillingManagementService;
  let billsRepo: { find: jest.Mock };
  let billRunsRepo: { findOne: jest.Mock };
  let unitsRepo: { find: jest.Mock };
  let meterReadingsRepo: { createQueryBuilder: jest.Mock };
  let tariffService: { resolveForUnits: jest.Mock; resolveForUnitsAsOf: jest.Mock };
  let customerService: { findByUnitId: jest.Mock; resolveCurrentCustomer: jest.Mock };
  let manager: { createQueryBuilder: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const ROUTINE_BILL_RUN = {
    id: 701,
    propertyId: 41,
    cycleMasterId: 9,
    cycleVersionId: 22,
    cyclePeriodStart: '2026-10-27',
    cyclePeriodEnd: '2026-10-30',
    billIssueDate: '2026-11-01',
    billDueDate: '2026-11-22',
    status: BillRunStatus.APPROVED,
    tariffResolutionDate: null,
  } as unknown as BillRun;

  const RECOVERY_BILL_RUN = {
    ...ROUTINE_BILL_RUN,
    id: 702,
    cyclePeriodStart: '2026-09-27',
    cyclePeriodEnd: '2026-09-30',
    tariffResolutionDate: '2026-09-27',
  } as unknown as BillRun;

  beforeEach(async () => {
    billsRepo = { find: jest.fn().mockResolvedValue([]) };
    billRunsRepo = { findOne: jest.fn() };
    unitsRepo = { find: jest.fn().mockResolvedValue([ONE_UNIT]) };
    // Two readings in-window so calculateConsumption resolves a real diff (opening 22331.2, closing
    // 22410.5 — the real SMT-AZG-003 values) rather than returning null.
    meterReadingsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qbStub([{ readingValue: '22410.5' }, { readingValue: '22331.2' }])) };
    tariffService = {
      resolveForUnits: jest.fn().mockResolvedValue(new Map([[2050, FLAT_TARIFF]])),
      resolveForUnitsAsOf: jest.fn().mockResolvedValue(new Map([[2050, FLAT_TARIFF]])),
    };
    customerService = {
      findByUnitId: jest.fn().mockResolvedValue([{ id: 68, residentType: 'tenant', accountStatus: 'active' }]),
      resolveCurrentCustomer: jest.fn().mockReturnValue({ currentCustomer: { id: 68 } }),
    };
    manager = {
      createQueryBuilder: jest.fn().mockReturnValue({ setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(null) }),
      create: jest.fn().mockImplementation((_entity, data) => ({ ...data })),
      save: jest.fn().mockImplementation((_entity, data) => Promise.resolve(Array.isArray(data) ? data : { id: 9001, ...data })),
    };
    dataSource = { transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingManagementService,
        { provide: getRepositoryToken(Bill), useValue: billsRepo },
        { provide: getRepositoryToken(BillLineItem), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(BillRun), useValue: billRunsRepo },
        { provide: getRepositoryToken(Unit), useValue: unitsRepo },
        { provide: getRepositoryToken(MeterReading), useValue: meterReadingsRepo },
        { provide: getRepositoryToken(TariffTier), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: TariffService, useValue: tariffService },
        { provide: CustomerService, useValue: customerService },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = moduleRef.get(BillingManagementService);
  });

  it('routine BillRun (tariffResolutionDate null): calls resolveForUnits, never resolveForUnitsAsOf', async () => {
    billRunsRepo.findOne.mockResolvedValue(ROUTINE_BILL_RUN);
    const result = await service.generateBillsForBillRun(701);

    expect(tariffService.resolveForUnits).toHaveBeenCalledWith([2050]);
    expect(tariffService.resolveForUnitsAsOf).not.toHaveBeenCalled();
    expect(result.generated).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it('recovery BillRun (tariffResolutionDate = 2026-09-27): calls resolveForUnitsAsOf with that exact date, never resolveForUnits', async () => {
    billRunsRepo.findOne.mockResolvedValue(RECOVERY_BILL_RUN);
    const result = await service.generateBillsForBillRun(702);

    expect(tariffService.resolveForUnitsAsOf).toHaveBeenCalledWith([2050], '2026-09-27');
    expect(tariffService.resolveForUnits).not.toHaveBeenCalled();
    expect(result.generated).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it('an \'ambiguous\' as-of-date tariff result is never passed through as if resolved — fails that unit explicitly, never silently picks one', async () => {
    billRunsRepo.findOne.mockResolvedValue(RECOVERY_BILL_RUN);
    tariffService.resolveForUnitsAsOf.mockResolvedValue(new Map([[2050, 'ambiguous' as const]]));

    const result = await service.generateBillsForBillRun(702);

    expect(result.generated).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/ambiguous/i);
  });
});

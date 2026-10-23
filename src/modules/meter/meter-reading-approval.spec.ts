import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MeterService } from './meter.service';
import { MasterMeter } from './entities/master-meter.entity';
import { SubMeter } from './entities/sub-meter.entity';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { User } from '../user/entities/user.entity';
import { MeterReading, ReadingApprovalStatus, ReadingValidationStatus } from '../sftp/entities/meter-reading.entity';
import { AttributeService } from '../attribute/attribute.service';
import { AuditService } from '../../audit/audit.service';
import { CustomerService } from '../customer/customer.service';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';

// Isolated unit tests for MeterService.setReadingApproval — the fix for a confirmed real bug: the
// Daily Meter Readings screen's Approve/Revoke buttons previously only mutated client-side React
// state (no backend route existed at all), so the "Approved" badge silently reverted on refresh and
// Billing Readiness/Field Inspection (which both query meter_readings.approval_status directly)
// never saw the change. This suite exercises the real, now-persisted transition exclusively — every
// dependency mocked, no real database connection.
describe('MeterService.setReadingApproval', () => {
  let service: MeterService;
  let usersRepo: { findOne: jest.Mock };
  let auditService: { record: jest.Mock };
  let manager: { find: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const APPROVED_READING = {
    id: 101,
    meterId: 'SMT-TEST-001',
    approvalStatus: ReadingApprovalStatus.APPROVED,
    approvedAt: new Date('2026-09-20T00:00:00.000Z'),
    approvedBy: 'SYSTEM',
  } as MeterReading;

  const PENDING_READING = {
    id: 102,
    meterId: 'SMT-TEST-002',
    approvalStatus: ReadingApprovalStatus.PENDING,
    approvedAt: null,
    approvedBy: null,
  } as unknown as MeterReading;

  beforeEach(async () => {
    usersRepo = { findOne: jest.fn().mockResolvedValue({ id: 7, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }) };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    manager = {
      find: jest.fn(),
      save: jest.fn().mockImplementation((_entity, data) => Promise.resolve(data)),
    };
    dataSource = { transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MeterService,
        { provide: getRepositoryToken(MasterMeter), useValue: {} },
        { provide: getRepositoryToken(SubMeter), useValue: {} },
        { provide: getRepositoryToken(Community), useValue: {} },
        { provide: getRepositoryToken(Property), useValue: {} },
        { provide: getRepositoryToken(Unit), useValue: {} },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(MeterReading), useValue: {} },
        { provide: AttributeService, useValue: {} },
        { provide: AuditService, useValue: auditService },
        { provide: CustomerService, useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: RolePermissionsService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(MeterService);
  });

  it('approve: sets approval_status to APPROVED, stamps real approvedAt/approvedBy from the real acting user, and records a real audit entry', async () => {
    manager.find.mockResolvedValue([{ ...PENDING_READING }]);

    const result = await service.setReadingApproval({ readingIds: [102] }, true, 7);

    expect(result).toEqual({ updated: 1, skipped: 0 });
    expect(manager.save).toHaveBeenCalledWith(
      MeterReading,
      expect.objectContaining({ id: 102, approvalStatus: ReadingApprovalStatus.APPROVED, approvedBy: 'Jane Doe' }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleName: 'MeterReading',
        entityId: 102,
        action: 'APPROVE',
        performedBy: 7,
        oldValue: expect.objectContaining({ approvalStatus: ReadingApprovalStatus.PENDING }),
        newValue: expect.objectContaining({ approvalStatus: ReadingApprovalStatus.APPROVED }),
      }),
      manager,
    );
  });

  it('revoke: reverts approval_status to PENDING and clears approvedAt/approvedBy — the enum has no separate "revoked" value', async () => {
    manager.find.mockResolvedValue([{ ...APPROVED_READING }]);

    const result = await service.setReadingApproval({ readingIds: [101] }, false, 7);

    expect(result).toEqual({ updated: 1, skipped: 0 });
    expect(manager.save).toHaveBeenCalledWith(
      MeterReading,
      expect.objectContaining({ id: 101, approvalStatus: ReadingApprovalStatus.PENDING, approvedAt: null, approvedBy: null }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REVOKE', entityId: 101 }),
      manager,
    );
  });

  it('bulk: approves every matching row in one call, one audit entry per row', async () => {
    manager.find.mockResolvedValue([{ ...PENDING_READING, id: 201 }, { ...PENDING_READING, id: 202 }, { ...PENDING_READING, id: 203 }]);

    const result = await service.setReadingApproval({ readingIds: [201, 202, 203] }, true, 7);

    expect(result).toEqual({ updated: 3, skipped: 0 });
    expect(manager.save).toHaveBeenCalledTimes(3);
    expect(auditService.record).toHaveBeenCalledTimes(3);
  });

  it('a stale/missing id is silently skipped, never failing the whole batch', async () => {
    // Only 2 of the 3 requested ids still exist — mirrors a bulk "Approve Selected" against a
    // selection that includes a row deleted/changed since the page was loaded.
    manager.find.mockResolvedValue([{ ...PENDING_READING, id: 301 }, { ...PENDING_READING, id: 302 }]);

    const result = await service.setReadingApproval({ readingIds: [301, 302, 999] }, true, 7);

    expect(result).toEqual({ updated: 2, skipped: 1 });
  });

  it('empty readingIds array is a no-op, never opens a transaction', async () => {
    const result = await service.setReadingApproval({ readingIds: [] }, true, 7);

    expect(result).toEqual({ updated: 0, skipped: 0 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('no actor resolved (actorId undefined) falls back to a null approvedBy rather than guessing a name', async () => {
    manager.find.mockResolvedValue([{ ...PENDING_READING }]);

    await service.setReadingApproval({ readingIds: [102] }, true, undefined);

    expect(usersRepo.findOne).not.toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(
      MeterReading,
      expect.objectContaining({ approvedBy: null }),
    );
  });

  it('actorName falls back to email when the user has no first/last name on file', async () => {
    usersRepo.findOne.mockResolvedValue({ id: 7, firstName: null, lastName: null, email: 'noname@example.com' });
    manager.find.mockResolvedValue([{ ...PENDING_READING }]);

    await service.setReadingApproval({ readingIds: [102] }, true, 7);

    expect(manager.save).toHaveBeenCalledWith(
      MeterReading,
      expect.objectContaining({ approvedBy: 'noname@example.com' }),
    );
  });
});

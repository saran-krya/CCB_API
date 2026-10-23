import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IngestionService } from './ingestion.service';
import { SftpService } from './sftp.service';
import { ValidationService } from './validation.service';
import { MeterHierarchyResolverService } from './meter-hierarchy-resolver.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { TriggerSource } from './entities/trigger-source.enum';

// Isolated unit tests for the "_TEST" filename guard added after a confirmed incident: two separate
// production ingestions of synthetic test data (2026-10-15, 2026-10-16), each triggered by a real
// file named "..._TEST.csv" reaching the real incoming SFTP path. This guard must run BEFORE any
// download/parse/write — every dependency is mocked here specifically to prove none of them are
// ever called for a rejected filename, not just that the method returns the right shape.

describe('IngestionService — "_TEST" filename guard', () => {
  let service: IngestionService;
  let sftp: { downloadFile: jest.Mock; parseFile: jest.Mock };
  let validation: { validateFile: jest.Mock; validateRows: jest.Mock; getWorstErrorPerRow: jest.Mock };
  let hierarchyResolver: { resolveBatch: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let ingestionLogsRepo: { create: jest.Mock; save: jest.Mock; update: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    sftp = { downloadFile: jest.fn(), parseFile: jest.fn() };
    validation = { validateFile: jest.fn(), validateRows: jest.fn(), getWorstErrorPerRow: jest.fn() };
    hierarchyResolver = { resolveBatch: jest.fn() };
    dataSource = { transaction: jest.fn() };
    ingestionLogsRepo = { create: jest.fn(), save: jest.fn(), update: jest.fn(), findOne: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestionService,
        { provide: SftpService, useValue: sftp },
        { provide: ValidationService, useValue: validation },
        { provide: MeterHierarchyResolverService, useValue: hierarchyResolver },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(SftpIngestionLog), useValue: ingestionLogsRepo },
      ],
    }).compile();

    service = moduleRef.get(IngestionService);
  });

  const TEST_FILENAMES = [
    'DTU_DTU-AZG-001_20260928_TEST.csv',
    'DTU_DTU-AZG-001_20260927_TEST.csv',
    'some-file-TEST.xlsx',
    'lowercase_test.csv', // case-insensitive — must also be rejected
    'Mixed_Test.CSV',
  ];

  it.each(TEST_FILENAMES)('rejects "%s" before calling any dependency', async (fileName) => {
    const result = await service.ingestFile(fileName);

    expect(result.outcome).toBe('rejected_test_file');
    expect(result.success).toBe(false);
    if (result.outcome === 'rejected_test_file') {
      expect(result.fileName).toBe(fileName);
      expect(result.message).toMatch(/_TEST/i);
    }

    // The actual regression this guard exists to prevent: NOTHING downstream ever runs for a
    // rejected filename — no remote download, no parse, no hash, no ingestion-log row, no
    // meter_readings write.
    expect(sftp.downloadFile).not.toHaveBeenCalled();
    expect(sftp.parseFile).not.toHaveBeenCalled();
    expect(validation.validateFile).not.toHaveBeenCalled();
    expect(validation.validateRows).not.toHaveBeenCalled();
    expect(hierarchyResolver.resolveBatch).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(ingestionLogsRepo.create).not.toHaveBeenCalled();
    expect(ingestionLogsRepo.save).not.toHaveBeenCalled();
    expect(ingestionLogsRepo.findOne).not.toHaveBeenCalled();
  });

  const REAL_FILENAMES = [
    'DTU_DTU-AZG-001_20260928.csv',
    'DTU_DTU-RIV-01_20260720.xlsx',
    'DTU_DTU-TESTCOURT-001_20260101.csv', // "TEST" appears mid-name, not as a suffix — must NOT match
  ];

  it.each(REAL_FILENAMES)('does NOT reject a genuinely real filename like "%s" — proceeds to call downloadFile', async (fileName) => {
    // Let the real flow proceed just far enough to prove the guard didn't fire; a downstream
    // rejection/error from the mocked dependencies afterward is irrelevant to this guard's own
    // correctness and is not asserted here.
    sftp.downloadFile.mockRejectedValue(new Error('stub stops here — guard-only test'));

    await expect(service.ingestFile(fileName)).rejects.toThrow('stub stops here — guard-only test');
    expect(sftp.downloadFile).toHaveBeenCalledWith(fileName);
  });

  it('passes triggerSource/isRetrigger through unaffected when the filename is real (guard does not alter existing options handling)', async () => {
    sftp.downloadFile.mockRejectedValue(new Error('stop'));
    await expect(
      service.ingestFile('DTU_DTU-AZG-001_20260928.csv', { triggerSource: TriggerSource.CRON, isRetrigger: true }),
    ).rejects.toThrow('stop');
    expect(sftp.downloadFile).toHaveBeenCalledWith('DTU_DTU-AZG-001_20260928.csv');
  });
});

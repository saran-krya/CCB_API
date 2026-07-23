import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paginate } from '../../common/utils/pagination.util';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { MeterReading } from './entities/meter-reading.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { SftpFileQueryDto } from './dto/sftp-file-query.dto';
import { Community } from '../community/entities/community.entity';
import { MasterMeter } from '../meter/entities/master-meter.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import {
  SftpFileListResponseDto,
  ResolvedFileLocation,
  toSftpFileListResponseDto,
} from './dto/sftp-file-list-response.dto';


const SORTABLE_COLUMNS: Record<string, string> = {
  createdAt: 'log.createdAt',
  fileName: 'log.fileName',
  fileStatus: 'log.fileStatus',
  fileSizeBytes: 'log.fileSizeBytes',
  processingCompletedAt: 'log.processingCompletedAt',
  receivedMeterCount: 'log.receivedMeterCount',
  validReadingCount: 'log.validReadingCount',
  anomalyCount: 'log.anomalyCount',
  community: 'community.name',
  property: 'property.name',
};


@Injectable()
export class SftpFileListService {
  constructor(
    @InjectRepository(SftpIngestionLog) private readonly ingestionLogs: Repository<SftpIngestionLog>,
    @InjectRepository(Community) private readonly communities: Repository<Community>,
    @InjectRepository(MeterReading) private readonly meterReadings: Repository<MeterReading>,
    @InjectRepository(MasterMeter) private readonly masterMeters: Repository<MasterMeter>,
    @InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>,
  ) {}

  async findAll(query: SftpFileQueryDto): Promise<SftpFileListResponseDto> {
    const { status, communityId, property, date, search, sortBy, sortOrder } = query;

    const orderCol = SORTABLE_COLUMNS[sortBy ?? ''] ?? SORTABLE_COLUMNS.createdAt;

    const qb = this.ingestionLogs
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.property', 'property')
      .leftJoinAndSelect('log.community', 'community')
      .orderBy(orderCol, sortOrder ?? 'DESC');

    if (status) qb.andWhere('log.file_status = :status', { status });
    if (communityId) qb.andWhere('community.id = :communityId', { communityId });
    if (property) qb.andWhere('property.property_name LIKE :property', { property: `%${property}%` });
    if (date) {
      qb.andWhere('(log.reading_date = :date OR DATE(log.created_at) = :date)', { date });
    }
    if (search) {
      qb.andWhere('(log.file_name LIKE :search OR log.dtu LIKE :search)', { search: `%${search}%` });
    }

    const result = await paginate(qb, query);
    const resolved = await this.resolveFileLocations(result.items);
    return toSftpFileListResponseDto(result, resolved);
  }


  private async resolveFileLocations(
    logs: SftpIngestionLog[],
  ): Promise<Map<number, ResolvedFileLocation>> {
    const result = new Map<number, ResolvedFileLocation>();

    const idsNeedingResolution = logs.filter((log) => !log.property && !log.community).map((log) => log.id);
    if (idsNeedingResolution.length === 0) return result;

    const readingRows = await this.meterReadings
      .createQueryBuilder('r')
      .select('r.meter_id', 'meterId')
      .addSelect('r.source_file_id', 'logId')
      .where('r.source_file_id IN (:...ids)', { ids: idsNeedingResolution })
      .getRawMany<{ meterId: string; logId: number }>();

    if (readingRows.length === 0) return result;

    const meterIds = [...new Set(readingRows.map((r) => r.meterId))];

    const [masterMeters, subMeters] = await Promise.all([
      this.masterMeters
        .createQueryBuilder('m')
        .innerJoinAndSelect('m.property', 'property')
        .innerJoinAndSelect('property.community', 'community')
        .where('m.business_code IN (:...meterIds)', { meterIds })
        .getMany(),
      this.subMeters
        .createQueryBuilder('s')
        .innerJoinAndSelect('s.property', 'property')
        .innerJoinAndSelect('property.community', 'community')
        .where('s.business_code IN (:...meterIds)', { meterIds })
        .getMany(),
    ]);

    const meterIdToLocation = new Map<string, { propertyId: number; propertyName: string; communityId: number; communityName: string }>();
    for (const m of [...masterMeters, ...subMeters]) {
      if (!m.businessCode) continue;
      meterIdToLocation.set(m.businessCode, {
        propertyId: m.property.id,
        propertyName: m.property.name,
        communityId: m.property.community.id,
        communityName: m.property.community.name,
      });
    }

    const meterIdsByLog = new Map<number, string[]>();
    for (const row of readingRows) {
      if (!meterIdsByLog.has(row.logId)) meterIdsByLog.set(row.logId, []);
      meterIdsByLog.get(row.logId)!.push(row.meterId);
    }

    for (const logId of idsNeedingResolution) {
      const resolvedMeters = (meterIdsByLog.get(logId) ?? [])
        .map((meterId) => meterIdToLocation.get(meterId))
        .filter((loc): loc is NonNullable<typeof loc> => !!loc);

      const distinctProperties = new Map(resolvedMeters.map((m) => [m.propertyId, m.propertyName]));
      const distinctCommunities = new Map(resolvedMeters.map((m) => [m.communityId, m.communityName]));

      result.set(logId, {
        property: distinctProperties.size === 0 ? null : distinctProperties.size === 1 ? [...distinctProperties.values()][0] : 'Multiple',
        community: distinctCommunities.size === 0 ? null : distinctCommunities.size === 1 ? [...distinctCommunities.values()][0] : 'Multiple',
      });
    }

    return result;
  }

  async getFilterMetadata() {
    const communities = await this.communities.find({ select: ['id', 'name'], order: { name: 'ASC' } });

    return {
      communities: communities.map((c) => ({ id: c.id, name: c.name })),
      statuses: [
        { value: SftpIngestionStatus.PROCESSED, label: 'Processed' },
        { value: SftpIngestionStatus.DUPLICATE, label: 'Duplicate' },
        { value: SftpIngestionStatus.MISSING, label: 'Missing' },
        { value: SftpIngestionStatus.FAILED, label: 'Failed' },
      ],
    };
  }
}

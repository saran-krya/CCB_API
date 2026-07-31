import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubMeter } from '../meter/entities/sub-meter.entity';

export interface ResolvedMeterHierarchy {
  subMeterId: number;
  unitId: number | null;
  propertyId: number;
  communityId: number;
}

@Injectable()
export class MeterHierarchyResolverService {
  private readonly logger = new Logger(MeterHierarchyResolverService.name);

  constructor(
    @InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>,
  ) {}

  async resolveBatch(meterIds: string[]): Promise<Map<string, ResolvedMeterHierarchy>> {
    const distinctIds = Array.from(new Set(meterIds.filter((id) => !!id)));
    const resolved = new Map<string, ResolvedMeterHierarchy>();
    if (distinctIds.length === 0) return resolved;

    const subMeters = await this.subMeters
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.property', 'property')
      .innerJoinAndSelect('property.community', 'community')
      .leftJoinAndSelect('s.unit', 'unit')
      .where('s.business_code IN (:...distinctIds)', { distinctIds })
      .getMany();

    for (const subMeter of subMeters) {
      if (!subMeter.businessCode) continue;
      resolved.set(subMeter.businessCode, {
        subMeterId: subMeter.id,
        unitId: subMeter.unit?.id ?? null,
        propertyId: subMeter.property.id,
        communityId: subMeter.property.community.id,
      });
    }

    const unresolvedCount = distinctIds.length - resolved.size;
    if (unresolvedCount > 0) {
      this.logger.warn(
        `Meter hierarchy resolution — ${unresolvedCount} of ${distinctIds.length} distinct meter_id(s) had no matching SubMeter this run`,
      );
    }

    return resolved;
  }
}

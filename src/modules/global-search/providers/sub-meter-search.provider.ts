import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubMeter } from '../../meter/entities/sub-meter.entity';
import { ACTION_CODES } from '../../../common/constants/action-codes.constants';
import { applyMultiWordSearch } from '../../../common/utils/search-text.util';
import { humanizeEnumValue } from '../../../common/utils/label.util';
import { GlobalSearchProvider, GlobalSearchResultItem, SearchAuthContext } from '../interfaces/search-provider.interface';

@Injectable()
export class SubMeterSearchProvider implements GlobalSearchProvider {
  readonly providerName = 'SubMeterSearchProvider';
  private static readonly MODULE_LABEL = 'Meter Management';

  constructor(@InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>) {}

  isEnabledFor(context: SearchAuthContext): boolean {
    return context.grantedActionCodes.has(ACTION_CODES.METER_VIEW);
  }

  async search(term: string, limit: number): Promise<GlobalSearchResultItem[]> {
    // /meters/inventory/sub-meters/[meterId] needs only the meter's own id, but the property relation is
    // still joined (never a second query per row) purely to read its name for the description, and also
    // searched, same reasoning as every other provider that joins a parent for context.
    const rows = await applyMultiWordSearch(
      this.subMeters
        .createQueryBuilder('meter')
        .innerJoin('meter.property', 'property')
        .select(['meter.id', 'meter.businessCode', 'meter.serialNumber', 'meter.status', 'property.name']),
      ['meter.businessCode', 'meter.serialNumber', 'property.name'],
      term,
    )
      .orderBy('meter.businessCode', 'ASC')
      .take(limit)
      .getMany();

    return rows.map((meter) => ({
      entityType: 'SUB_METER',
      id: String(meter.id),
      module: SubMeterSearchProvider.MODULE_LABEL,
      title: meter.businessCode ?? meter.serialNumber ?? `Sub Meter #${meter.id}`,
      description: meter.property.name,
      status: humanizeEnumValue(meter.status),
      url: `/meters/inventory/sub-meters/${meter.id}`,
    }));
  }
}

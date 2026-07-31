import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { OccupancyStatus, Unit, UnitType } from '../unit/entities/unit.entity';

const RESIDENTIAL_UNIT_TYPES = [UnitType.APARTMENT, UnitType.STUDIO];
const COMMERCIAL_UNIT_TYPES = [UnitType.OFFICE, UnitType.SHOP, UnitType.GARAGE];

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Community) private readonly communityRepo: Repository<Community>,
    @InjectRepository(Property) private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
  ) {}

  async getStats() {
    const [totalCommunities, totalProperties, occupiedUnits, vacantUnits] = await Promise.all([
      this.communityRepo.count(),
      this.propertyRepo.count(),
      this.unitRepo.count({ where: { occupancyStatus: OccupancyStatus.OCCUPIED } }),
      this.unitRepo.count({ where: { occupancyStatus: OccupancyStatus.VACANT } }),
    ]);

    return {
      totalCommunities,
      totalProperties,
      totalUnits: occupiedUnits + vacantUnits,
      occupiedUnits,
      vacantUnits,
      paidInvoices: 0,
      unpaidInvoices: 0,
      overdueBills: 0,
    };
  }

  async getUnitOccupancy() {
    const [residentialOccupied, residentialVacant, commercialOccupied, commercialVacant] = await Promise.all([
      this.unitRepo.count({ where: { unitType: In(RESIDENTIAL_UNIT_TYPES), occupancyStatus: OccupancyStatus.OCCUPIED } }),
      this.unitRepo.count({ where: { unitType: In(RESIDENTIAL_UNIT_TYPES), occupancyStatus: OccupancyStatus.VACANT } }),
      this.unitRepo.count({ where: { unitType: In(COMMERCIAL_UNIT_TYPES), occupancyStatus: OccupancyStatus.OCCUPIED } }),
      this.unitRepo.count({ where: { unitType: In(COMMERCIAL_UNIT_TYPES), occupancyStatus: OccupancyStatus.VACANT } }),
    ]);

    return {
      residential: { occupied: residentialOccupied, vacant: residentialVacant },
      commercial: { occupied: commercialOccupied, vacant: commercialVacant },
    };
  }

  async getConsumption(month?: string) {
    const communities = await this.communityRepo.find({ order: { name: 'ASC' } });
    return {
      month: month ?? null,
      communities: communities.map((community) => ({
        community: community.name,
        residential: 0,
        commercial: 0,
      })),
    };
  }

  async getBillingPipeline(month?: string) {
    const communities = await this.communityRepo.find({ order: { name: 'ASC' } });
    return {
      month: month ?? null,
      communities: communities.map((community) => ({
        community: community.name,
        billedPaid: 0,
        billedUnpaid: 0,
        readyToBill: 0,
        onHold: 0,
      })),
    };
  }
}

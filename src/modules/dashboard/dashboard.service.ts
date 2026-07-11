import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { OccupancyStatus, Unit, UnitType } from '../unit/entities/unit.entity';

// Every unit is classified into exactly one of these two buckets for the
// Residential/Commercial occupancy donuts — Garage is grouped under
// Commercial (ancillary/parking use, not living space) so the two donuts
// always sum to the platform-wide Total Units figure with nothing excluded.
const RESIDENTIAL_UNIT_TYPES = [UnitType.APARTMENT, UnitType.STUDIO];
const COMMERCIAL_UNIT_TYPES = [UnitType.OFFICE, UnitType.SHOP, UnitType.GARAGE];

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Community) private readonly communityRepo: Repository<Community>,
    @InjectRepository(Property) private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
  ) {}

  // Top stat-card row. Community/Property/Unit are real, implemented
  // entities — counted directly. Invoice/billing figures are always 0:
  // the Billing Engine / Invoice module doesn't exist yet, so there is no
  // real data to report instead of mock numbers.
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

  // Residential/Commercial occupancy donuts — four small, fixed COUNT
  // queries run concurrently (not per-row, so not an N+1 pattern).
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

  // Community Consumption chart. No meter-reading/ingestion module exists
  // yet, so every community reports 0 rather than invented BTU figures —
  // the community list itself is real.
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

  // Billing Cycle Revenue Pipeline chart. No Billing Engine/Invoice module
  // exists yet, so every stage reports 0 rather than invented AED figures —
  // the community list itself is real.
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

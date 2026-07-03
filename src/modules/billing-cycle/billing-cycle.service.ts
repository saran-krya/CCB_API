import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { LovService } from '../lov/lov.service';
import {
  BillingCycleQueryDto,
  CreateBillingCycleDto,
  UpdateBillingCycleDto,
} from './dto/billing-cycle.dto';
import { BillingCycle, BillingCycleStatus } from './entities/billing-cycle.entity';

@Injectable()
export class BillingCycleService {
  constructor(
    @InjectRepository(BillingCycle)
    private readonly billingCycles: Repository<BillingCycle>,
    @InjectRepository(Community)
    private readonly communities: Repository<Community>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    private readonly lovService: LovService,
  ) {}

  async getFilterMetadata() {
    const [communitiesRaw, propertiesRaw, frequencies] = await Promise.all([
      this.communities.find({ select: ['id', 'name'], order: { name: 'ASC' } }),
      this.dataSource.query<Array<{ id: number; name: string; communityId: number }>>(
        'SELECT id, property_name AS name, community_id AS communityId FROM properties WHERE deleted_at IS NULL ORDER BY property_name ASC',
      ),
      this.lovService.findByCategory('BILLING_FREQUENCY'),
    ]);

    return {
      communities: communitiesRaw.map((c) => ({ id: c.id, name: c.name })),
      properties: propertiesRaw,
      frequencies: frequencies.map((f) => ({ code: f.code, label: f.label })),
      statuses: [
        { value: BillingCycleStatus.ACTIVE, label: 'Active' },
        { value: BillingCycleStatus.INACTIVE, label: 'Inactive' },
      ],
      readingDays: Array.from({ length: 31 }, (_, i) => i + 1),
    };
  }

  async getStats() {
    const rows = await this.dataSource.query<any[]>(`
      SELECT
        COUNT(DISTINCT bc.community_id)                                              AS totalCommunities,
        COUNT(DISTINCT bc.property_id)                                               AS totalProperties,
        SUM(CASE WHEN bc.status = 'active'   THEN 1 ELSE 0 END)                     AS activeCycles,
        SUM(CASE WHEN bc.status = 'inactive' THEN 1 ELSE 0 END)                     AS inactiveCycles,
        COUNT(bc.id)                                                                  AS totalCycles
      FROM billing_cycles bc
      WHERE bc.deleted_at IS NULL
    `);

    const billsDueThisWeek = await this.countBillsDueThisWeek();
    const row = rows[0] ?? {};

    return {
      totalCommunities: Number(row.totalCommunities ?? 0),
      totalProperties: Number(row.totalProperties ?? 0),
      activeCycles: Number(row.activeCycles ?? 0),
      inactiveCycles: Number(row.inactiveCycles ?? 0),
      billsDueThisWeek,
    };
  }

  private async countBillsDueThisWeek(): Promise<number> {
    const cycles = await this.billingCycles.find({ select: ['readingEndDay', 'billIssueDays', 'billDueDays'] });
    const now = new Date();
    const weekStart = now;
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let count = 0;
    for (const cycle of cycles) {
      const dueDate = this.computeBillDueDateObj(cycle);
      if (dueDate && dueDate >= weekStart && dueDate <= weekEnd) count++;
    }
    return count;
  }

  private computeBillDueDateObj(cycle: Pick<BillingCycle, 'readingEndDay' | 'billIssueDays' | 'billDueDays'>): Date | null {
    if (!cycle.readingEndDay) return null;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const readingEndDate = new Date(year, month, cycle.readingEndDay);
    const billIssueDate = new Date(readingEndDate);
    billIssueDate.setDate(billIssueDate.getDate() + (cycle.billIssueDays ?? 0));
    const billDueDate = new Date(billIssueDate);
    billDueDate.setDate(billDueDate.getDate() + (cycle.billDueDays ?? 0));
    return billDueDate;
  }

  private formatBillDueDate(cycle: Pick<BillingCycle, 'readingEndDay' | 'billIssueDays' | 'billDueDays'>): string | null {
    const d = this.computeBillDueDateObj(cycle);
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatBillCycleId(id: number): string {
    return `BCY-${String(id).padStart(3, '0')}`;
  }

  private mapToResponse(bc: BillingCycle) {
    return {
      id: bc.id,
      billCycleId: this.formatBillCycleId(bc.id),
      communityId: bc.communityId,
      communityName: (bc.community as any)?.name ?? '',
      propertyId: bc.propertyId,
      propertyName: (bc.property as any)?.name ?? '',
      propertyCode: (bc.property as any)?.code ?? '',
      frequency: bc.frequency,
      readingStartDay: bc.readingStartDay,
      readingEndDay: bc.readingEndDay,
      billGenerationDays: bc.billGenerationDays,
      billIssueDays: bc.billIssueDays,
      billDueDays: bc.billDueDays,
      billDueDate: this.formatBillDueDate(bc),
      status: bc.status,
      lastChangeReason: bc.lastChangeReason ?? null,
      businessCode: bc.businessCode ?? null,
      createdAt: bc.createdAt,
      updatedAt: bc.updatedAt,
    };
  }

  async create(dto: CreateBillingCycleDto, actorId?: number) {
    const existing = await this.billingCycles.findOne({
      where: { propertyId: dto.propertyId },
    });
    if (existing) {
      throw new ConflictException(
        'A billing cycle already exists for this property',
      );
    }

    const [community, property] = await Promise.all([
      this.communities.findOne({ where: { id: dto.communityId } }),
      this.properties.findOne({ where: { id: dto.propertyId } }),
    ]);
    if (!community) throw new NotFoundException('Community not found');
    if (!property) throw new NotFoundException('Property not found');

    const saved = await this.dataSource.transaction(async (manager) => {
      const entity = manager.create(BillingCycle, {
        ...dto,
        status: dto.status ?? BillingCycleStatus.INACTIVE,
      });
      const s = await manager.save(BillingCycle, entity);
      s.businessCode = `ILCY-${String(s.id).padStart(6, '0')}`;
      await manager.save(BillingCycle, s);

      await this.audit.record({
        moduleName: 'billing_cycles',
        entityId: s.id,
        action: 'CREATE',
        newValue: {
          propertyId: s.propertyId,
          communityId: s.communityId,
          frequency: s.frequency,
          status: s.status,
        },
        performedBy: actorId,
      });

      return s;
    });

    return this.findOne(saved.id);
  }

  async findAll(query: BillingCycleQueryDto) {
    const { communityId, propertyId, property, frequency, status, readingStartDay, readingEndDay, sortBy, sortOrder, search } = query;

    const SORTABLE = new Set(['createdAt', 'updatedAt', 'status', 'frequency', 'readingStartDay', 'readingEndDay']);
    const orderCol = SORTABLE.has(sortBy ?? '') ? sortBy! : 'createdAt';

    const qb = this.billingCycles
      .createQueryBuilder('bc')
      .leftJoinAndSelect('bc.community', 'community')
      .leftJoinAndSelect('bc.property', 'property')
      .orderBy(`bc.${orderCol}`, sortOrder ?? 'DESC');

    if (communityId) qb.andWhere('bc.community_id = :communityId', { communityId });
    if (propertyId) qb.andWhere('bc.property_id = :propertyId', { propertyId });
    if (property) qb.andWhere('property.property_name LIKE :propertyName', { propertyName: `%${property}%` });
    if (frequency) qb.andWhere('bc.frequency = :frequency', { frequency });
    if (status) qb.andWhere('bc.status = :status', { status });
    if (readingStartDay) qb.andWhere('bc.reading_start_day = :readingStartDay', { readingStartDay });
    if (readingEndDay) qb.andWhere('bc.reading_end_day = :readingEndDay', { readingEndDay });
    if (search) {
      qb.andWhere(
        '(community.name LIKE :s OR property.property_name LIKE :s OR property.property_code LIKE :s OR bc.businessCode LIKE :s)',
        { s: `%${search}%` },
      );
    }

    const result = await paginate(qb, query);
    return {
      items: result.items.map((bc) => this.mapToResponse(bc)),
      pagination: result.pagination,
    };
  }

  async findOne(id: number) {
    const bc = await this.billingCycles.findOne({
      where: { id },
      relations: ['community', 'property'],
    });
    if (!bc) throw new NotFoundException('Billing cycle not found');
    return this.mapToResponse(bc);
  }

  async findByProperty(propertyId: number) {
    const bc = await this.billingCycles.findOne({
      where: { propertyId },
      relations: ['community', 'property'],
    });
    if (!bc) throw new NotFoundException('Billing cycle not found for this property');
    return this.mapToResponse(bc);
  }

  async update(id: number, dto: UpdateBillingCycleDto, actorId?: number) {
    const bc = await this.billingCycles.findOne({
      where: { id },
      relations: ['community', 'property'],
    });
    if (!bc) throw new NotFoundException('Billing cycle not found');

    const oldValue = {
      frequency: bc.frequency,
      readingStartDay: bc.readingStartDay,
      readingEndDay: bc.readingEndDay,
      billGenerationDays: bc.billGenerationDays,
      billIssueDays: bc.billIssueDays,
      billDueDays: bc.billDueDays,
      status: bc.status,
    };

    const { reasonForChange, ...fields } = dto;
    Object.assign(bc, fields);
    if (reasonForChange) bc.lastChangeReason = reasonForChange;

    const saved = await this.billingCycles.save(bc);

    await this.audit.record({
      moduleName: 'billing_cycles',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: { ...fields, reasonForChange },
      performedBy: actorId,
    });

    return this.mapToResponse(saved);
  }

  async remove(id: number, actorId?: number) {
    const bc = await this.billingCycles.findOne({ where: { id } });
    if (!bc) throw new NotFoundException('Billing cycle not found');

    await this.billingCycles.softRemove(bc);

    await this.audit.record({
      moduleName: 'billing_cycles',
      entityId: id,
      action: 'DELETE',
      oldValue: { propertyId: bc.propertyId, communityId: bc.communityId, status: bc.status },
      performedBy: actorId,
    });

    return { deleted: true };
  }
}

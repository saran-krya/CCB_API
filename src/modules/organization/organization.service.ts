import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTION, AUDIT_MODULE } from '../../audit/audit.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { paginate } from '../../common/utils/pagination.util';
import { SORT_ORDER } from '../../common/constants/sort.constants';
import {
  AssignSubscriptionDto,
  CreateOrganizationDto,
  OrganizationQueryDto,
  UpdateOrganizationDto,
  UpdateOrganizationStatusDto,
} from './dto/create-organization.dto';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { SubscriptionPlanService } from './subscription-plan.service';

/**
 * Valid organization-status transitions (OrganizationService.updateStatus is the only place a status
 * can change — never a plain field update via `update()`, which deliberately excludes `status`). Any
 * pair not listed here is rejected, not left to the caller/frontend to avoid.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<OrganizationStatus, OrganizationStatus[]> = {
  [OrganizationStatus.PENDING]: [OrganizationStatus.ACTIVE, OrganizationStatus.INACTIVE],
  [OrganizationStatus.ACTIVE]: [OrganizationStatus.SUSPENDED, OrganizationStatus.INACTIVE],
  [OrganizationStatus.SUSPENDED]: [OrganizationStatus.ACTIVE, OrganizationStatus.INACTIVE],
  [OrganizationStatus.INACTIVE]: [OrganizationStatus.ACTIVE],
};

@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly subscriptionPlans: SubscriptionPlanService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateOrganizationDto, actorId?: number): Promise<Organization> {
    const existing = await this.organizations.findOne({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`Organization code already exists: ${dto.code}`);

    if (dto.subscriptionPlanId) {
      await this.subscriptionPlans.findOne(dto.subscriptionPlanId);
    }

    const org = this.organizations.create({
      ...dto,
      status: OrganizationStatus.PENDING,
    });
    const saved = await this.organizations.save(org);

    await this.audit.record({
      moduleName: AUDIT_MODULE.ORGANIZATIONS,
      entityId: saved.id,
      action: AUDIT_ACTION.CREATE,
      newValue: { name: saved.name, code: saved.code, status: saved.status },
      performedBy: actorId,
    });

    return saved;
  }

  async findAll(query: OrganizationQueryDto) {
    const { status, search, sortBy, sortOrder } = query;

    const qb = this.organizations
      .createQueryBuilder('o')
      .orderBy(`o.${sortBy ?? 'createdAt'}`, sortOrder ?? SORT_ORDER.DESC);

    if (search) {
      qb.andWhere('(o.name LIKE :s OR o.code LIKE :s OR o.primaryContactEmail LIKE :s)', { s: `%${search}%` });
    }
    if (status) qb.andWhere('o.organization_status = :status', { status });

    return paginate(qb, query);
  }

  async findOne(id: number): Promise<Organization> {
    const org = await this.organizations.findOne({ where: { id }, relations: ['subscriptionPlan'] });
    if (!org) throw new NotFoundException(ERROR_MESSAGES.ORGANIZATION_NOT_FOUND);
    return org;
  }

  async update(id: number, dto: UpdateOrganizationDto, actorId?: number): Promise<Organization> {
    const org = await this.findOne(id);

    if (dto.code && dto.code !== org.code) {
      const exists = await this.organizations.findOne({ where: { code: dto.code } });
      if (exists) throw new ConflictException('Organization code already exists');
    }

    const oldValue = { name: org.name, code: org.code };
    Object.assign(org, dto);
    const saved = await this.organizations.save(org);

    await this.audit.record({
      moduleName: AUDIT_MODULE.ORGANIZATIONS,
      entityId: id,
      action: AUDIT_ACTION.UPDATE,
      oldValue,
      newValue: { name: saved.name, code: saved.code },
      performedBy: actorId,
    });

    return saved;
  }

  async updateStatus(id: number, dto: UpdateOrganizationStatusDto, actorId?: number): Promise<Organization> {
    const org = await this.findOne(id);
    const allowed = ALLOWED_STATUS_TRANSITIONS[org.status] ?? [];
    if (org.status !== dto.status && !allowed.includes(dto.status)) {
      throw new BadRequestException(ERROR_MESSAGES.ORGANIZATION_STATUS_TRANSITION_INVALID);
    }

    const oldStatus = org.status;
    org.status = dto.status;
    const saved = await this.organizations.save(org);

    await this.audit.record({
      moduleName: AUDIT_MODULE.ORGANIZATIONS,
      entityId: id,
      action: AUDIT_ACTION.UPDATE,
      oldValue: { status: oldStatus },
      newValue: { status: saved.status },
      performedBy: actorId,
    });

    return saved;
  }

  async assignSubscription(id: number, dto: AssignSubscriptionDto, actorId?: number): Promise<Organization> {
    const org = await this.findOne(id);
    await this.subscriptionPlans.findOne(dto.subscriptionPlanId);

    const oldValue = {
      subscriptionPlanId: org.subscriptionPlanId,
      subscriptionExpiryDate: org.subscriptionExpiryDate,
    };
    org.subscriptionPlanId = dto.subscriptionPlanId;
    org.subscriptionStartDate = dto.subscriptionStartDate;
    org.subscriptionExpiryDate = dto.subscriptionExpiryDate;
    const saved = await this.organizations.save(org);

    await this.audit.record({
      moduleName: AUDIT_MODULE.SUBSCRIPTION_PLANS,
      entityId: id,
      action: AUDIT_ACTION.UPDATE,
      oldValue,
      newValue: {
        subscriptionPlanId: saved.subscriptionPlanId,
        subscriptionStartDate: saved.subscriptionStartDate,
        subscriptionExpiryDate: saved.subscriptionExpiryDate,
      },
      performedBy: actorId,
    });

    return this.findOne(id);
  }

  async findOneEntity(id: number): Promise<Organization> {
    return this.findOne(id);
  }
}

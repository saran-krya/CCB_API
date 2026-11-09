import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTION, AUDIT_MODULE } from '../../audit/audit.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { SubscriptionPlan } from './entities/subscription-plan.entity';

@Injectable()
export class SubscriptionPlanService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly plans: Repository<SubscriptionPlan>,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSubscriptionPlanDto, actorId?: number): Promise<SubscriptionPlan> {
    const existing = await this.plans.findOne({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`Subscription plan code already exists: ${dto.code}`);

    const plan = this.plans.create({ ...dto, isActive: dto.isActive ?? true });
    const saved = await this.plans.save(plan);

    await this.audit.record({
      moduleName: AUDIT_MODULE.SUBSCRIPTION_PLANS,
      entityId: saved.id,
      action: AUDIT_ACTION.CREATE,
      newValue: { name: saved.name, code: saved.code },
      performedBy: actorId,
    });

    return saved;
  }

  findAll(): Promise<SubscriptionPlan[]> {
    return this.plans.find({ order: { createdAt: 'ASC' } });
  }

  async findOne(id: number): Promise<SubscriptionPlan> {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(ERROR_MESSAGES.SUBSCRIPTION_PLAN_NOT_FOUND);
    return plan;
  }

  async update(id: number, dto: UpdateSubscriptionPlanDto, actorId?: number): Promise<SubscriptionPlan> {
    const plan = await this.findOne(id);
    const oldValue = { name: plan.name, isActive: plan.isActive };
    Object.assign(plan, dto);
    const saved = await this.plans.save(plan);

    await this.audit.record({
      moduleName: AUDIT_MODULE.SUBSCRIPTION_PLANS,
      entityId: id,
      action: AUDIT_ACTION.UPDATE,
      oldValue,
      newValue: { name: saved.name, isActive: saved.isActive },
      performedBy: actorId,
    });

    return saved;
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { UserInvitation } from './entities/user-invitation.entity';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { SubscriptionPlanService } from './subscription-plan.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, SubscriptionPlan, UserInvitation])],
  controllers: [OrganizationController],
  providers: [OrganizationService, SubscriptionPlanService],
  exports: [OrganizationService, SubscriptionPlanService],
})
export class OrganizationModule {}

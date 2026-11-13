import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { Community } from '../community/entities/community.entity';
import { Policy } from '../iam/entities/policy.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Property } from '../property/entities/property.entity';
import { Role } from '../role/entities/role.entity';
import { SystemHealthModule } from '../system-health/system-health.module';
import { Unit } from '../unit/entities/unit.entity';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../user-role/entities/user-role.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PlatformDashboardService } from './platform-dashboard.service';

// The second group of entities feeds PlatformDashboardService (SUPER_ADMIN only) with read-only counts. AuditLogQueryService comes from
// the @Global AuditModule; SystemHealthModule exports the health probes the dashboard summarises.
@Module({
  imports: [
    TypeOrmModule.forFeature([Community, Property, Unit, User, UserRole, RefreshToken, Role, Policy, PModule]),
    SystemHealthModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, PlatformDashboardService],
})
export class DashboardModule {}

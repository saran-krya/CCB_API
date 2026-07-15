import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { typeOrmConfig } from './config/typeorm.config';
import { CommunityModule } from './modules/community/community.module';
import { PropertyModule } from './modules/property/property.module';
import { RoleModule } from './modules/role/role.module';
import { UnitModule } from './modules/unit/unit.module';
import { UserModule } from './modules/user/user.module';
import { BusinessRoleModule } from './modules/business-role/business-role.module';
import { SubModulesModule } from './modules/sub-modules/sub-modules.module';
import { RolePermissionsModule } from './modules/role-permissions/role-permissions.module';
import { ScreensModule } from './modules/screens/screens.module';
import { PModulesModule } from './modules/pmodules/pmodules.module';
import { ActionsModule } from './modules/actions/actions.module';
import { BillingCycleModule } from './modules/billing-cycle/billing-cycle.module';
import { LovModule } from './modules/lov/lov.module';
import { AttributeModule } from './modules/attribute/attribute.module';
import { BusinessCodeMigrationModule } from './common/migrations/business-code-migration.module';
import { MeterUniquenessMigrationModule } from './common/migrations/meter-uniqueness-migration.module';
import { TariffModule } from './modules/tariff/tariff.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MeterModule } from './modules/meter/meter.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync(typeOrmConfig),
    AuditModule,
    AuthModule,
    RoleModule,
    UserModule,
    CommunityModule,
    PropertyModule,
    UnitModule,
    BusinessRoleModule,
    PModulesModule,
    SubModulesModule,
    ActionsModule,
    RolePermissionsModule,
    ScreensModule,
    BillingCycleModule,
    TariffModule,
    LovModule,
    AttributeModule,
    BusinessCodeMigrationModule,
    MeterUniquenessMigrationModule,
    DashboardModule,
    MeterModule,
    BootstrapModule,
  ],
})
export class AppModule {}

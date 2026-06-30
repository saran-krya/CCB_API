import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { UserCategoryModule } from './modules/user-category/user-category.module';
import { BusinessRoleModule } from './modules/business-role/business-role.module';
import { SubModulesModule } from './modules/sub-modules/sub-modules.module';
import { RolePermissionsModule } from './modules/role-permissions/role-permissions.module';
import { ScreensModule } from './modules/screens/screens.module';
import { PModulesModule } from './modules/pmodules/pmodules.module';
import { ActionsModule } from './modules/actions/actions.module';
import { UserTypeModule } from './modules/user-type/user-type.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync(typeOrmConfig),
    AuditModule,
    AuthModule,
    RoleModule,
    UserModule,
    CommunityModule,
    PropertyModule,
    UnitModule,
    UserCategoryModule,
    BusinessRoleModule,
    PModulesModule,
    SubModulesModule,
    ActionsModule,
    RolePermissionsModule,
    ScreensModule,
    UserTypeModule,
    BootstrapModule,
  ],
})
export class AppModule {}

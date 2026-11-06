import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeModule } from '../attribute/attribute.module';
import { LovModule } from '../lov/lov.module';
import { RolePermissionsModule } from '../role-permissions/role-permissions.module';
import { UserPreference } from './entities/user-preference.entity';
import { NotificationPolicyService } from './notification-policy.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserPreference]), AttributeModule, LovModule, ConfigModule, RolePermissionsModule],
  controllers: [SettingsController],
  providers: [SettingsService, NotificationPolicyService],
  // Exported for any module that sends a staff notification: it asks NotificationPolicyService whether it may (system switch +
  // the recipient's own preference) before sending.
  exports: [NotificationPolicyService],
})
export class SettingsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CUSTOMER_INVITATION_ISSUER } from '../customer/customer-invitation.port';
import { CustomerModule } from '../customer/customer.module';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { IamModule } from '../iam/iam.module';
import { User } from '../user/entities/user.entity';
import { UserRoleModule } from '../user-role/user-role.module';
import { UserModule } from '../user/user.module';
import { AccountInvitationController } from './account-invitation.controller';
import { AccountInvitationScheduler } from './account-invitation.scheduler';
import { AccountInvitationService } from './account-invitation.service';
import { AccountInvitationSubscriber } from './account-invitation.subscriber';
import { AccountInvitation } from './entities/account-invitation.entity';

/**
 * Account invitations for staff and customers.
 *
 * Imported by AppModule (activated 2026-11-12 — see docs/INVITATIONS_AND_EMAIL_TEMPLATES.md). `TypeOrmModule.forFeature([...])` below registers the
 * AccountInvitation entity; its table is created by migration 1795600000000 (src/migrations), whose DDL is kept identical to the entity, so
 * development `synchronize` never alters it. Taking this module out of AppModule switches the feature off again (the tables stay): the customer
 * activation e-mail then goes out exactly as it did before, and the staff wizard offers only its two password options.
 *
 * The CUSTOMER_INVITATION_ISSUER provider is how CustomerService finds this module without depending on it (ModuleRef lookup by token).
 */
@Module({
  imports: [
    // `User` is registered here only to read staff names; the entity belongs to UserModule.
    TypeOrmModule.forFeature([AccountInvitation, User]),
    UserModule,
    UserRoleModule,
    CustomerModule,
    EmailTemplateModule,
    IamModule,
  ],
  controllers: [AccountInvitationController],
  providers: [
    AccountInvitationService,
    AccountInvitationScheduler,
    AccountInvitationSubscriber,
    { provide: CUSTOMER_INVITATION_ISSUER, useExisting: AccountInvitationService },
  ],
  exports: [AccountInvitationService],
})
export class AccountInvitationModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resource } from './entities/resource.entity';
import { Policy } from './entities/policy.entity';
import { PolicyStatement } from './entities/policy-statement.entity';
import { RolePolicy } from './entities/role-policy.entity';
import { UserInlinePolicy } from './entities/user-inline-policy.entity';
import { UserInlinePolicyStatement } from './entities/user-inline-policy-statement.entity';
import { RoleInlinePolicy } from './entities/role-inline-policy.entity';
import { RoleInlinePolicyStatement } from './entities/role-inline-policy-statement.entity';
import { Role } from '../role/entities/role.entity';
import { User } from '../user/entities/user.entity';
import { Action } from '../actions/entities/action.entity';
import { IamService } from './iam.service';
import { PolicyQueryService } from './policy-query.service';
import { UserInlinePolicyService } from './user-inline-policy.service';
import { RoleInlinePolicyService } from './role-inline-policy.service';
import { PolicyController, RolePolicyController } from './policy.controller';
import { UserInlinePolicyController } from './user-inline-policy.controller';
import { RoleInlinePolicyController } from './role-inline-policy.controller';
import { UserPermissionsController } from './user-permissions.controller';
import { UserPermissionsService } from './user-permissions.service';
import { UserRole } from '../user-role/entities/user-role.entity';
import { ResourceController } from './resource.controller';
import { AuditModule } from '../../audit/audit.module';

/**
 * The IAM (Role -> Policy -> Resource -> Action) module — additive, parallel to the existing
 * Module/SubModule/Screen/Action + RolePermission tree, which this module neither modifies nor
 * depends on writing to. Depends on Role/Action entities READ-ONLY (validating a roleId/actionCode
 * exists), never imports RoleModule/RolePermissionsModule/ActionsModule themselves — avoids any
 * circular dependency, since RolePermissionsService (Stage A/B dual-path guard support) is the one
 * that will import THIS module's IamService, not the other way around.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Resource, Policy, PolicyStatement, RolePolicy, UserInlinePolicy, UserInlinePolicyStatement,
      RoleInlinePolicy, RoleInlinePolicyStatement, Role, User, Action, UserRole,
    ]),
    AuditModule,
  ],
  controllers: [
    PolicyController, ResourceController, RolePolicyController, UserInlinePolicyController,
    RoleInlinePolicyController, UserPermissionsController,
  ],
  providers: [IamService, PolicyQueryService,UserInlinePolicyService, RoleInlinePolicyService, UserPermissionsService],
  exports: [IamService],
})
export class IamModule {}

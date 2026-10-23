import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resource } from './entities/resource.entity';
import { Policy } from './entities/policy.entity';
import { PolicyStatement } from './entities/policy-statement.entity';
import { RolePolicy } from './entities/role-policy.entity';
import { Role } from '../role/entities/role.entity';
import { Action } from '../actions/entities/action.entity';
import { IamService } from './iam.service';
import { PolicyController, RolePolicyController } from './policy.controller';
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
    TypeOrmModule.forFeature([Resource, Policy, PolicyStatement, RolePolicy, Role, Action]),
    AuditModule,
  ],
  controllers: [PolicyController, ResourceController, RolePolicyController],
  providers: [IamService],
  exports: [IamService],
})
export class IamModule {}

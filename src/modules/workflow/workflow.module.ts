import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Action } from '../actions/entities/action.entity';
import { RolePermission } from '../role-permissions/entities/role-permission.entity';
import { RolePermissionsModule } from '../role-permissions/role-permissions.module';
import { Role } from '../role/entities/role.entity';
import { User } from '../user/entities/user.entity';
import { UserRoleModule } from '../user-role/user-role.module';
import { WorkflowApprovalLevel } from './entities/workflow-approval-level.entity';
import { WorkflowDefinition } from './entities/workflow-definition.entity';
import { WorkflowDefinitionLevel } from './entities/workflow-definition-level.entity';
import { WorkflowInstance } from './entities/workflow-instance.entity';
import { WorkflowInstanceStep } from './entities/workflow-instance-step.entity';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowOrchestrationService } from './workflow-orchestration.service';
import { WorkflowSlaSchedulerService } from './workflow-sla-scheduler.service';

// getApprovalFlow queries roles/role_permissions/actions directly via the injected DataSource
// (no repository needed); setApprovers() needs the Action/RolePermission repositories to resolve
// each approve action's module chain and write/remove grants; Role + WorkflowApprovalLevel back
// the OLD advisory POLICY-record read/write (getApprovalPolicy/updateApprovalPolicy) — kept in
// place, superseded functionally by WorkflowDefinitionService but not removed (see the
// orchestration migration's own doc comment).
//
// WorkflowDefinitionService/WorkflowOrchestrationService are the real engine: versioned
// definitions + execution instances. RolePermissionsModule is imported for the definition
// service's save-time "does this role actually hold the approve permission" check (§J);
// UserRoleModule for the orchestration service's role-resolution (never users.role_id).
//
// Deliberately imports NONE of Tariff/BillRun/BillingCycleModule, even though
// WorkflowSlaSchedulerService's AUTO_APPROVE path needs to call each domain's own approve()
// method. Importing them directly would create a real circular dependency (all three already
// import WorkflowModule for WorkflowOrchestrationService) that, in this codebase's actual module
// graph, cascades through several OTHER modules too (BillingReadinessModule, BillingManagementModule,
// RegistrationRequestModule all independently import TariffModule/BillingCycleModule — each would
// also need forwardRef() to break the resulting longer cycles, confirmed by hitting each one in
// turn via NestJS's own bootstrap error before this approach was abandoned in favor of the one
// below). Instead, each domain service registers its own AUTO_APPROVE handler directly with
// WorkflowOrchestrationService at construction time (see TariffService/BillRunService/
// BillingCycleService's own constructors, and WorkflowOrchestrationService.registerAutoApproveHandler's
// own doc comment) — the dependency keeps flowing the same direction every other edge in this
// module graph already does (domain -> workflow, never reversed), so zero new circular imports.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Action,
      RolePermission,
      Role,
      WorkflowApprovalLevel,
      WorkflowDefinition,
      WorkflowDefinitionLevel,
      WorkflowInstance,
      WorkflowInstanceStep,
      User,
    ]),
    RolePermissionsModule,
    UserRoleModule,
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowDefinitionService, WorkflowOrchestrationService, WorkflowSlaSchedulerService],
  exports: [WorkflowService, WorkflowDefinitionService, WorkflowOrchestrationService],
})
export class WorkflowModule {}

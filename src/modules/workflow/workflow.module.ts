import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Action } from '../actions/entities/action.entity';
import { RolePermission } from '../role-permissions/entities/role-permission.entity';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

// getApprovalFlow queries roles/role_permissions/actions directly via the injected DataSource
// (no repository needed); setApprovers() needs the Action/RolePermission repositories to resolve
// each approve action's module chain and write/remove grants — see WorkflowService's own doc
// comment. Workflow owns neither entity itself, only this one narrow write onto them.
@Module({
  imports: [TypeOrmModule.forFeature([Action, RolePermission])],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}

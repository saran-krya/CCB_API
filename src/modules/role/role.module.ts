import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { Role } from './entities/role.entity';
import { AuditModule } from '../../audit/audit.module';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { Screen } from '../screens/entities/screen.entity';
import { Action } from '../actions/entities/action.entity';
import { RolePermission } from '../role-permissions/entities/role-permission.entity';

@Module({
  imports: [
    AuditModule,
    TypeOrmModule.forFeature([
      Role,
      PModule,
      SubModule,
      Screen,
      Action,
      RolePermission,
    ]),
  ],
  controllers: [RoleController],
  providers: [RoleService],
  exports: [
    RoleService,
    TypeOrmModule,
  ],
})
export class RoleModule {}
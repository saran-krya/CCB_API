import { TypeOrmModule } from '@nestjs/typeorm';

import { RolePermission } from './entities/role-permission.entity';
import { Role } from '../role/entities/role.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { Action } from '../actions/entities/action.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Screen } from '../screens/entities/screen.entity';
import { RolePermissionsController } from './role-permissions.controller';
import { RolePermissionsService } from './role-permissions.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RolePermission,
      Role,
      SubModule,
      Action,
      PModule,
      Screen,
    ]),
  ],
  controllers: [
    RolePermissionsController,
  ],
  providers: [
    RolePermissionsService,
  ],
  exports: [
    RolePermissionsService,
  ],
})
export class RolePermissionsModule { }
import { Module } from '@nestjs/common'
import { LovModule } from '../modules/lov/lov.module'
import { AttributeModule } from '../modules/attribute/attribute.module'
import { PModulesModule } from '../modules/pmodules/pmodules.module'
import { SubModulesModule } from '../modules/sub-modules/sub-modules.module'
import { ScreensModule } from '../modules/screens/screens.module'
import { ActionsModule } from '../modules/actions/actions.module'
import { RolePermissionsModule } from '../modules/role-permissions/role-permissions.module'
import { BootstrapService } from './bootstrap.service'

@Module({
  imports: [
    LovModule,
    AttributeModule,
    PModulesModule,
    SubModulesModule,
    ScreensModule,
    ActionsModule,
    RolePermissionsModule,
  ],
  providers: [BootstrapService],
})
export class BootstrapModule {}

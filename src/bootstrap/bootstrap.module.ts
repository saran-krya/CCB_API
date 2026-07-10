import { Module } from '@nestjs/common'
import { LovModule } from '../modules/lov/lov.module'
import { AttributeModule } from '../modules/attribute/attribute.module'
import { PModulesModule } from '../modules/pmodules/pmodules.module'
import { SubModulesModule } from '../modules/sub-modules/sub-modules.module'
import { ScreensModule } from '../modules/screens/screens.module'
import { ActionsModule } from '../modules/actions/actions.module'
import { RolePermissionsModule } from '../modules/role-permissions/role-permissions.module'
import { BootstrapService } from './bootstrap.service'

/**
 * Runs once on first startup (empty database) to seed:
 *   user categories → user types → modules → sub-modules → screens → actions
 *   → roles → default Super Admin user → LOV values → SUPER_ADMIN/ADMIN
 *   permission grants
 *
 * Requires env vars: DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD
 */
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

import { Module } from '@nestjs/common'
import { LovModule } from '../modules/lov/lov.module'
import { AttributeModule } from '../modules/attribute/attribute.module'
import { BootstrapService } from './bootstrap.service'

/**
 * Runs once on first startup (empty database) to seed:
 *   user categories → user types → modules → sub-modules → screens → actions
 *   → roles → default Super Admin user → LOV values
 *
 * Requires env vars: DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD
 */
@Module({
  imports: [LovModule, AttributeModule],
  providers: [BootstrapService],
})
export class BootstrapModule {}

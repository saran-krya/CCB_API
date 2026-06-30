import { Module } from '@nestjs/common'
import { BootstrapService } from './bootstrap.service'

/**
 * Runs once on first startup (empty database) to seed:
 *   user categories → user types → modules → sub-modules → screens → actions
 *   → roles → default Super Admin user
 *
 * Requires env vars: DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD
 */
@Module({
  providers: [BootstrapService],
})
export class BootstrapModule {}

import { Module } from '@nestjs/common';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';

// DataSource (TypeOrmModule root) and RedisService (@Global RedisModule) are available app-wide, so nothing is imported here.
// The service is exported for the SUPER_ADMIN dashboard, which embeds a compact summary of the same checks.
@Module({
  controllers: [SystemHealthController],
  providers: [SystemHealthService],
  exports: [SystemHealthService],
})
export class SystemHealthModule {}

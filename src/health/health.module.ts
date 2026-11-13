import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// DataSource (TypeOrmModule.forRootAsync) and RedisService (a @Global module) are available everywhere; nothing else is needed.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}

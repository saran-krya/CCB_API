import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * Liveness and readiness for orchestrators, load balancers and uptime monitors — public, un-versioned and outside the API prefix on purpose
 * (`/health/live`, `/health/ready`; see main.ts), so a probe configuration never changes with the API version. They answer with a bare status and
 * never reveal versions, hosts or error text. Exempt from the request throttle: a probe that gets 429 during an attack would make a healthy instance
 * look dead. The signed-in details are in System Health (SUPER_ADMIN).
 */
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running (never checks a dependency)' })
  @ApiOkResponse({ description: '{ "status": "ok" }' })
  live(@Res() res: Response): void {
    res.status(200).json(this.health.live());
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the database answers, the schema is current and the process is not shutting down' })
  @ApiOkResponse({ description: '{ "status": "ok" | "degraded", "checks": { … } } — degraded = Redis is down (optional)' })
  @ApiServiceUnavailableResponse({ description: 'The database is down, a migration is pending, or the process is shutting down' })
  async ready(@Res() res: Response): Promise<void> {
    // @Res() (not passthrough) so the plain body below is sent as it is, without the { success, data } envelope the application's JSON responses use.
    const report = await this.health.ready();
    res.status(report.httpStatus).json(report.body);
  }
}

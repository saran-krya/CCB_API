import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../../common/constants/global';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemHealthResponse } from './dto/system-health-response.dto';
import { SystemHealthService } from './system-health.service';

/**
 * Live health of the API, the database and Redis (SUPER_ADMIN only — the same gate as `GET /settings/system/info`, which is also
 * `@Roles(SUPER_ADMIN)` rather than a delegable permission code: infrastructure state is the platform administrator's alone).
 * Customer sessions are refused by default (no @CustomerAccessible). Never returns connection strings, credentials or
 * environment variables.
 */
@ApiBearerAuth()
@ApiTags('System Health')
@Roles(ROLES.SUPER_ADMIN)
@Controller({ path: 'system-health', version: '1' })
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  @Get()
  @ApiOperation({ summary: 'Run the API, database and Redis health checks now (SUPER_ADMIN only)' })
  getHealth(): Promise<SystemHealthResponse> {
    return this.health.check();
  }
}

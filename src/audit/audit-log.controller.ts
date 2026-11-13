import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../common/constants/global';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditLogQueryService } from './audit-log-query.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogDetail, AuditLogListResponse } from './dto/audit-log-response.dto';

/**
 * The platform audit trail (SUPER_ADMIN only — `@Roles(SUPER_ADMIN)` rather than a delegable permission code, the same gate as
 * the System Settings routes: the trail spans every module and every user, so only the platform administrator reads it).
 * Read-only by design: there is no route that creates, edits or deletes an entry. Customer sessions are refused by default
 * (no @CustomerAccessible).
 */
@ApiBearerAuth()
@ApiTags('Audit Logs')
@Roles(ROLES.SUPER_ADMIN)
@Controller({ path: 'audit-logs', version: '1' })
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit-trail entries, newest first, with filters (module, action, user, record, date range, search) and pagination (SUPER_ADMIN only)',
  })
  findAll(@Query() query: AuditLogQueryDto): Promise<AuditLogListResponse> {
    return this.auditLogs.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One audit-trail entry with its old and new values (secret-looking values masked) (SUPER_ADMIN only)' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<AuditLogDetail> {
    return this.auditLogs.findOne(id);
  }
}

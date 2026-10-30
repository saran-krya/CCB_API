import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { UserPermissionsQueryDto } from './dto/user-permissions-query.dto';
import { UserPermissionsService } from './user-permissions.service';

@ApiBearerAuth()
@ApiTags('IAM User Permissions')
@Controller({ path: 'users/:userId/permissions', version: '1' })
export class UserPermissionsController {
  constructor(private readonly permissions: UserPermissionsService) {}

  @Get()
  @Permission('VIEW_USER')
  @ApiOperation({
    summary:
      "A user's roles and (SUPER_ADMIN viewers only) inline policies as one searchable, filterable, sortable, paged list, plus the type filter options.",
  })
  list(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: UserPermissionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.permissions.list(userId, query, actor);
  }
}

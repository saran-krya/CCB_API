import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ApiResponseDto } from '../../common/dto/api-response.dto';
import { GlobalSearchQueryDto } from './dto/global-search-query.dto';
import { GlobalSearchResponseDataDto } from './dto/global-search-response.dto';
import { GlobalSearchService } from './global-search.service';

@ApiBearerAuth()
@ApiTags('Global Search')
@Controller({ path: 'global-search', version: '1' })
export class GlobalSearchController {
  constructor(private readonly globalSearch: GlobalSearchService) {}

  // Deliberately @Authenticated(), not a single @Permission(...) — every signed-in staff session may
  // call this, exactly like typing into AWS Console's or Jira's own search bar never itself needs a
  // permission. What's actually returned is cut down per caller inside GlobalSearchService, module by
  // module, against that SAME caller's real action-code grants and SUPER_ADMIN status — the identical
  // authorization this app already enforces on each entity's own list/detail endpoint, reused here
  // rather than re-decided. A result this endpoint would refuse to return, the matching page's own
  // guard would refuse too; this never grants access the rest of the app wouldn't already allow.
  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Search across every module the caller can see, grouped by module.' })
  @ApiResponse({ status: 200, type: GlobalSearchResponseDataDto })
  async search(
    @Query() query: GlobalSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiResponseDto<GlobalSearchResponseDataDto>> {
    const roleIds = user.roleIds?.length ? user.roleIds : [user.roleId];
    const data = await this.globalSearch.search(query.q, query.limit ?? 10, roleIds, user.sub);
    return { success: true, message: 'OK', data };
  }
}

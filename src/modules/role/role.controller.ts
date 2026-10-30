import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CreateRoleDto, UpdateRoleDto } from './dto/create-role.dto';
import { RolePickerQueryDto } from './dto/role-picker-query.dto';
import { RoleService } from './role.service';
import { ROLES } from '@app/common/constants/global';
import { RoleQueryDto } from '@app/common/dto/role-paginatoin.dto';

/**
 * @Roles(ROLES.ADMIN) at the class level is unchanged (RolesGuard still runs first; SUPER_ADMIN
 * always bypasses it, any ADMIN-named role must still pass it) — the @Permission additions below
 * are a SECOND, ADDITIONAL check NestJS's APP_GUARD chain ANDs together with it (JwtAuthGuard ->
 * CustomerAccessGuard -> RolesGuard -> PermissionGuard, see AuthModule's provider order), never a
 * replacement or relaxation. This closes the confirmed RBAC audit finding that VIEW_ROLE/
 * CREATE_ROLE/EDIT_ROLE/DELETE_ROLE were seeded, shown in the ACL editor, and referenced by the
 * frontend's usePermission() gates, but never actually checked by any backend route here — so
 * granting or revoking them in the Roles & Permissions screen was previously cosmetic for this
 * controller. Confirmed safe before this change: only SUPER_ADMIN currently satisfies
 * @Roles(ROLES.ADMIN) in this environment (no role is named exactly "ADMIN" today), and SUPER_ADMIN
 * already holds all four codes (role-permissions.service.ts's ensureAdminGrants auto-grants every
 * active, non-excluded action — including these four, none of which are in
 * ADMIN_GRANT_EXCLUDED_ACTION_CODES — to any role named SUPER_ADMIN or ADMIN on every boot), so no
 * existing or future ADMIN-named role loses access as a result of this change.
 */
@ApiBearerAuth()
@ApiTags('Roles')
@Roles(ROLES.ADMIN)
@Controller({ path: 'roles', version: '1' })
export class RoleController {
  constructor(private readonly roles: RoleService) { }

  @Post()
  @Permission('CREATE_ROLE')
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Get()
  @Permission('VIEW_ROLE')
  findAll(
    @Query() query: RoleQueryDto,
  ) {
    return this.roles.RoleLists(query);
  }

  @Get('dropdown')
  getRoleDropdown(
    @Query('userCategoryId')
    userCategoryId?: string,
  ) {
    return this.roles.getRoleDropdown(
      userCategoryId ? Number(userCategoryId) : undefined,
    );
  }
  // Same guard as `dropdown` (reachable from Create / Edit User), declared above `:id` so it never shadows.
  @Get('picker')
  getRolePicker(@Query() query: RolePickerQueryDto) {
    return this.roles.getRolePicker(query);
  }

  @Get("filter")
  getRoleFilter() {
    return this.roles.getRoleFilter();
  }

  @Get("metaFilters")
  getFilterMetadata() {
    return this.roles.getFilterMetadata();
  }

  @Get(':id')
  @Permission('VIEW_ROLE')
  findOne(@Param('id') id: number) {
    return this.roles.findOne(id);
  }

  // Backs the Role Detail page specifically — assigned-user count + updatedAt, neither of which
  // plain findOne() above needs for its other two callers (see RoleService.findOneWithDetails'
  // own doc comment). Nested under the numeric id (`:id/details`), not a bare `:id`, so it can't
  // collide with `dropdown`/`filter`/`metaFilters` above and never shadows the plain findOne route.
  @Get(':id/details')
  @Permission('VIEW_ROLE')
  findOneWithDetails(@Param('id') id: number) {
    return this.roles.findOneWithDetails(id);
  }

  @Patch(':id')
  @Permission('EDIT_ROLE')
  update(@Param('id') id: number, @Body() dto: UpdateRoleDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.roles.update(id, dto, user?.sub);
  }

  @Delete(':id')
  @Permission('DELETE_ROLE')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.roles.remove(id, user?.sub);
  }
}

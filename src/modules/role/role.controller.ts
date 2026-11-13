import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { actorFrom } from '../../common/security/actor';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CreateRoleDto, UpdateRoleDto } from './dto/create-role.dto';
import { RolePickerQueryDto } from './dto/role-picker-query.dto';
import { RoleService } from './role.service';
import { RoleQueryDto } from '@app/common/dto/role-paginatoin.dto';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';


@ApiBearerAuth()
@ApiTags('Roles')
@Controller({ path: 'roles', version: '1' })
export class RoleController {
  constructor(private readonly roles: RoleService) { }

  @Post()
  @Permission(ACTION_CODES.CREATE_ROLE)
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.create(dto, user?.sub);
  }

  @Get()
  @Permission(ACTION_CODES.VIEW_ROLE)
  findAll(
    @Query() query: RoleQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // The viewer decides whether SUPER_ADMIN is in the list: only a super administrator sees it.
    return this.roles.RoleLists(query, actorFrom(user));
  }

  @Get('dropdown')
  @Permission(ACTION_CODES.VIEW_ROLE, ACTION_CODES.CREATE_USER, ACTION_CODES.EDIT_USER)
  getRoleDropdown(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userCategoryId')
    userCategoryId?: string,
  ) {
    return this.roles.getRoleDropdown(
      userCategoryId ? Number(userCategoryId) : undefined,
      actorFrom(user),
    );
  }
  // Same guard as `dropdown` (reachable from Create / Edit User), declared above `:id` so it never shadows.
  @Get('picker')
  @Permission(ACTION_CODES.VIEW_ROLE, ACTION_CODES.CREATE_USER, ACTION_CODES.EDIT_USER)
  getRolePicker(@Query() query: RolePickerQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.getRolePicker(query, actorFrom(user));
  }

  @Get("filter")
  @Permission(ACTION_CODES.VIEW_ROLE, ACTION_CODES.CREATE_USER, ACTION_CODES.EDIT_USER)
  getRoleFilter(@CurrentUser() user: AuthenticatedUser) {
    return this.roles.getRoleFilter(actorFrom(user));
  }

  @Get("metaFilters")
  @Permission(ACTION_CODES.VIEW_ROLE, ACTION_CODES.CREATE_USER, ACTION_CODES.EDIT_USER)
  getFilterMetadata() {
    return this.roles.getFilterMetadata();
  }

  @Get(':id')
  @Permission(ACTION_CODES.VIEW_ROLE)
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.findOneVisibleTo(id, actorFrom(user));
  }

  // Backs the Role Detail page specifically — assigned-user count + updatedAt, neither of which
  // plain findOne() above needs for its other two callers (see RoleService.findOneWithDetails'
  // own doc comment). Nested under the numeric id (`:id/details`), not a bare `:id`, so it can't
  // collide with `dropdown`/`filter`/`metaFilters` above and never shadows the plain findOne route.
  @Get(':id/details')
  @Permission(ACTION_CODES.VIEW_ROLE)
  findOneWithDetails(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.findOneWithDetails(id, actorFrom(user));
  }

  @Patch(':id')
  @Permission(ACTION_CODES.EDIT_ROLE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.update(id, dto, actorFrom(user));
  }

  @Delete(':id')
  @Permission(ACTION_CODES.DELETE_ROLE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.remove(id, user?.sub);
  }
}

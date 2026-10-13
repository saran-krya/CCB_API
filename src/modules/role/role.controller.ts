import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CreateRoleDto, UpdateRoleDto } from './dto/create-role.dto';
import { RoleService } from './role.service';
import { ROLES } from '@app/common/constants/global';
import { RoleQueryDto } from '@app/common/dto/role-paginatoin.dto';

@ApiBearerAuth()
@ApiTags('Roles')
@Roles(ROLES.ADMIN)
@Controller({ path: 'roles', version: '1' })
export class RoleController {
  constructor(private readonly roles: RoleService) { }

  @Post()
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Get()
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
  @Get("filter")
  getRoleFilter() {
    return this.roles.getRoleFilter();
  }

  @Get("metaFilters")
  getFilterMetadata() {
    return this.roles.getFilterMetadata();
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.roles.findOne(id);
  }

  // Backs the Role Detail page specifically — assigned-user count + updatedAt, neither of which
  // plain findOne() above needs for its other two callers (see RoleService.findOneWithDetails'
  // own doc comment). Nested under the numeric id (`:id/details`), not a bare `:id`, so it can't
  // collide with `dropdown`/`filter`/`metaFilters` above and never shadows the plain findOne route.
  @Get(':id/details')
  findOneWithDetails(@Param('id') id: number) {
    return this.roles.findOneWithDetails(id);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() dto: UpdateRoleDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.roles.update(id, dto, user?.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.roles.remove(id, user?.sub);
  }
}

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
    userCategoryId: number,

    @Query('userTypeId')
    userTypeId: number,
  ) {
    return this.roles.getRoleDropdown(
      Number(userCategoryId),
      Number(userTypeId),
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

  @Patch(':id')
  update(@Param('id') id: number, @Body() dto: UpdateRoleDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.roles.update(id, dto, user?.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.roles.remove(id, user?.sub);
  }
}

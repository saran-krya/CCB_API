import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UserService } from './user.service';

// Route-level @Permission() — gates the admin-CRUD routes by Screen Action
// (USER_LIST screen) instead of hardcoded roles, so access is controlled
// entirely through Role Permissions per role, not role names. Self-service
// routes (profile, reporting-managers, me/preferences) are intentionally
// unguarded, as before — any authenticated user manages their own profile
// regardless of role or grants.
@ApiBearerAuth()
@ApiTags('Users')
@Controller({ path: 'users', version: '1' })
export class UserController {
  constructor(private readonly users: UserService) { }


  @Post()
  @Permission('CREATE_USER')
  create(@Body() dto: CreateUserDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.create(dto, user?.sub);
  }

  @Get()
  @Permission('USER_OVERVIEW')
  findAll(@Query() query: PaginationQueryDto) {
    return this.users.findAll(query);
  }

  @Get("profile")
  getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.getProfile(user.sub);
  }

  @Get("reporting-managers")
  getReportingManagers() {
    return this.users.getReportingManagers();
  }

  // Self-service — any authenticated user manages their own appearance
  // preferences, regardless of role.
  @Patch("me/preferences")
  updateOwnPreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.updateOwnPreferences(user.sub, dto);
  }

  @Get("dashboard-summary")
  @Permission('USER_OVERVIEW')
  getDashboardSummary() {
    return this.users.getDashboard();
  }


  @Get(":id")
  @Permission('USER_OVERVIEW')
  findOne(@Param("id") id: number) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @Permission('EDIT_USER')
  update(@Param('id') id: number, @Body() dto: UpdateUserDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.update(id, dto, user?.sub);
  }

  @Delete(':id')
  @Permission('DELETE_USER')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.remove(id, user?.sub);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UserService } from './user.service';
import { ROLES } from '@app/common/constants/global';

@ApiBearerAuth()
@ApiTags('Users')
@Controller({ path: 'users', version: '1' })
export class UserController {
  constructor(private readonly users: UserService) { }


  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  create(@Body() dto: CreateUserDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.create(dto, user?.sub);
  }

  @Get()
  @Roles(ROLES.SUPER_ADMIN)
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
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN
  )
  getDashboardSummary() {
    return this.users.getDashboard();
  }


  @Get(":id")
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  findOne(@Param("id") id: number) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  update(@Param('id') id: number, @Body() dto: UpdateUserDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.update(id, dto, user?.sub);
  }

  @Delete(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.remove(id, user?.sub);
  }
}

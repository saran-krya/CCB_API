import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UserService } from './user.service';

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
  @Permission('VIEW_USER')
  findAll(@Query() query: UserQueryDto) {
    return this.users.findAll(query);
  }

  @Get("profile")
  getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.getProfile(user.sub);
  }

  // Populates the "Reporting Manager" picker in User create/edit (UserForm.tsx) — real staff data
  // (names, employee codes, roles), same reasoning as field-inspectors below, gated on whichever of
  // User create/edit the picker is reachable from. Previously had no guard at all (any authenticated
  // staff member, any role, could list it) — found during the Policy-based authorization audit.
  @Get("reporting-managers")
  @Permission('CREATE_USER', 'EDIT_USER')
  getReportingManagers() {
    return this.users.getReportingManagers();
  }

  // Populates Request Field Inspection's "Assign To" picker — gated on the same single permission
  // that grants access to all of Billing Readiness (the dialog this lives inside is reachable from
  // any of its tabs), since this is real staff data (names), not generic config like an LOV list.
  @Get("field-inspectors")
  @Permission('BILLING_READINESS_VIEW')
  getFieldInspectors() {
    return this.users.getFieldInspectors();
  }

  @Patch("me/preferences")
  updateOwnPreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.updateOwnPreferences(user.sub, dto);
  }

  @Get(":id")
  @Permission('VIEW_USER')
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

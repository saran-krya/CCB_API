import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { AddUserRolesDto } from './dto/add-user-roles.dto';
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

  // Declared above ":id" so it is never read as a user id.
  @Get("filters")
  @Permission('VIEW_USER')
  getFilterOptions() {
    return this.users.getFilterOptions();
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

  // The ONLY way to change a user's roles (UpdateUserDto has no role field). Gated on EDIT_USER like
  // the rest of user editing; the self-change / last-role / last-SUPER_ADMIN rules are enforced
  // server-side, inside UserRoleService's transaction (via UserService), never left to the UI hiding
  // a button.
  @Post(':id/roles')
  @Permission('EDIT_USER')
  @ApiOperation({ summary: "Adds roles to a user — additive and idempotent (already-held roles are skipped). Returns the user's full roles array after the change." })
  @ApiParam({ name: 'id', type: Number })
  addRoles(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddUserRolesDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.users.addRoles(id, dto.roleIds, user?.sub);
  }

  @Delete(':id/roles/:roleId')
  @Permission('EDIT_USER')
  @ApiOperation({ summary: "Removes ONE role from a user — idempotent (a role not held is a no-op). Refused for your own user, for a user's last remaining role, and for the last SUPER_ADMIN. Returns the user's full roles array after the change." })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'roleId', type: Number })
  removeRole(
    @Param('id', ParseIntPipe) id: number,
    @Param('roleId', ParseIntPipe) roleId: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.users.removeRole(id, roleId, user?.sub);
  }

  @Delete(':id')
  @Permission('DELETE_USER')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.remove(id, user?.sub);
  }
}

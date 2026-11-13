import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';
import { ADMINISTRATOR_ROLES } from '../../common/security/administrator-roles';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { RolePermissionsService } from './role-permissions.service';
import {
  CreateRolePermissionDto
} from './dto/create-role-permission.dto';
import { SaveRoleWithPermissionsDto } from './dto/save-role-with-permissions.dto';

@ApiBearerAuth()
@ApiTags('Role Permissions')
@Roles(...ADMINISTRATOR_ROLES)
@Controller({
  path: 'role-permissions',
  version: '1',
})
export class RolePermissionsController {
  constructor(
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateRolePermissionDto,
  ) {
    return this.rolePermissionsService.create(dto);
  }

  @Get("tree")
  getPermissionTree() {
    // The editor's tree: without the administration console's pages and permissions (they are SUPER_ADMIN's alone).
    return this.rolePermissionsService.getPermissionTree(undefined, { forEditing: true });
  }

  @Get("role/:roleId")
  getRolePermissionByRoleId(
    @Param("roleId", ParseIntPipe) roleId: number,
  ) {
    return this.rolePermissionsService.getPermissionTree(
      Number(roleId),
      { forEditing: true },
    );
  }

  @Post("save")
  savePermissions(
    @Body()
    dto: SaveRoleWithPermissionsDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.rolePermissionsService.savePermissions(
      dto,
      user?.sub,
    );
  }

  @Patch("role/:roleId")
  updateRolePermissions(
    @Param("roleId", ParseIntPipe) roleId: number,
    @Body()
    dto: SaveRoleWithPermissionsDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.rolePermissionsService.updateRolePermissions(
      Number(roleId),
      dto,
      user?.sub,
    );
  }

  @Get("user")
  getUserPermissions(
    @Query("roleId") roleId: number,
  ) {
    return this.rolePermissionsService.getUserPermissions(
      Number(roleId),
    );
  }

  @Get("all-menus")
  getAllMenus() {
    return this.rolePermissionsService.getAllMenus();
  }
}
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';
import { ROLES } from '@app/common/constants/global';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolePermissionsService } from './role-permissions.service';
import {
  CreateRolePermissionDto
} from './dto/create-role-permission.dto';
import { SaveRoleWithPermissionsDto } from './dto/save-role-with-permissions.dto';

@ApiBearerAuth()
@ApiTags('Role Permissions')
@Roles(ROLES.SUPER_ADMIN)
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
    return this.rolePermissionsService.getPermissionTree();
  }

  @Get("role/:roleId")
  getRolePermissionByRoleId(
    @Param("roleId") roleId: number,
  ) {
    return this.rolePermissionsService.getPermissionTree(
      Number(roleId),
    );
  }

  @Post("save")
  savePermissions(
    @Body()
    dto: SaveRoleWithPermissionsDto,
  ) {
    return this.rolePermissionsService.savePermissions(
      dto,
    );
  }

  @Patch("role/:roleId")
  updateRolePermissions(
    @Param("roleId") roleId: number,
    @Body()
    dto: SaveRoleWithPermissionsDto,
  ) {
    return this.rolePermissionsService.updateRolePermissions(
      Number(roleId),
      dto,
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
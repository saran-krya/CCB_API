import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import { BusinessRoleService } from "./business-role.service";

import {
  CreateBusinessRoleDto,
  UpdateBusinessRoleDto,
} from "./dto/create-business-role.dto";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "@app/common/decorators/roles.decorator";
import { ROLES } from "@app/common/constants/global";

@ApiBearerAuth()
@ApiTags("Business Roles")
@Controller({
  path: "business-roles",
  version: "1",
})
export class BusinessRoleController {
  constructor(
    private readonly businessRoleService: BusinessRoleService,
  ) { }

  @Post()
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
  )
  create(
    @Body()
    dto: CreateBusinessRoleDto,
  ) {
    return this.businessRoleService.create(dto);
  }

  @Get()
  findAll() {
    return this.businessRoleService.findAll();
  }

  @Patch(":id")
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
  )
  update(
    @Param("id") id: number,
    @Body() dto: UpdateBusinessRoleDto,
  ) {
    return this.businessRoleService.update(
      id,
      dto,
    );
  }

  @Delete(":id")
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
  )
  remove(
    @Param("id") id: number,
  ) {
    return this.businessRoleService.remove(
      id,
    );
  }
}
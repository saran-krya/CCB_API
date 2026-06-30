import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiTags,
} from "@nestjs/swagger";


import { UserCategoryService } from "./user-category.service";

import {
  CreateUserCategoryDto,
  UpdateUserCategoryDto,
} from "./dto/create-user-category.dto";
import { ROLES } from "@app/common/constants/global";
import { Roles } from "@app/common/decorators/roles.decorator";

@ApiBearerAuth()
@ApiTags("User Categories")
@Controller({
  path: "user-categories",
  version: "1",
})
export class UserCategoryController {
  constructor(
    private readonly userCategoryService: UserCategoryService,
  ) {}

  @Post()
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
  )
  create(
    @Body()
    dto: CreateUserCategoryDto,
  ) {
    return this.userCategoryService.create(
      dto,
    );
  }

  @Get()
  findAll() {
    return this.userCategoryService.findAll();
  }

  @Get(":id")
  findOne(
    @Param("id")
    id: number,
  ) {
    return this.userCategoryService.findOne(
      id,
    );
  }

  @Patch(":id")
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
  )
  update(
    @Param("id")
    id: number,
    @Body()
    dto: UpdateUserCategoryDto,
  ) {
    return this.userCategoryService.update(
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
    @Param("id")
    id: number,
  ) {
    return this.userCategoryService.remove(
      id,
    );
  }
}
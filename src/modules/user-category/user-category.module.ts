import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UserCategory } from "./entities/user-category.entity";
import { UserCategoryController } from "./user-category.controller";
import { UserCategoryService } from "./user-category.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserCategory,
    ]),
  ],
  controllers: [
    UserCategoryController,
  ],
  providers: [
    UserCategoryService,
  ],
  exports: [
    UserCategoryService,
  ],
})
export class UserCategoryModule {}
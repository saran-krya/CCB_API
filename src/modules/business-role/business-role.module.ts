import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BusinessRole } from "./entities/business-role.entity";
import { BusinessRoleController } from "./business-role.controller";
import { BusinessRoleService } from "./business-role.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BusinessRole,
    ]),
  ],
  controllers: [
    BusinessRoleController,
  ],
  providers: [
    BusinessRoleService,
  ],
  exports: [
    BusinessRoleService,
  ],
})
export class BusinessRoleModule {}
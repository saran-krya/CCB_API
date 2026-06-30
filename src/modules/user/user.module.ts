import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleModule } from '../role/role.module';
import { User } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserCategory } from '../user-category/entities/user-category.entity';
import { BusinessRole } from '../business-role/entities/business-role.entity';
import { RolePermissionsModule } from '../role-permissions/role-permissions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserCategory,
      BusinessRole,
    ]), RoleModule,
    RolePermissionsModule,

  ], controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule { }

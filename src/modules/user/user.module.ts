import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleModule } from '../role/role.module';
import { User } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { BusinessRole } from '../business-role/entities/business-role.entity';
import { RolePermissionsModule } from '../role-permissions/role-permissions.module';
import { AttributeModule } from '../attribute/attribute.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      BusinessRole,
    ]), RoleModule,
    RolePermissionsModule,
    AttributeModule,

  ], controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule { }

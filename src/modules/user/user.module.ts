import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleModule } from '../role/role.module';
import { User } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { RolePermissionsModule } from '../role-permissions/role-permissions.module';
import { AttributeModule } from '../attribute/attribute.module';
import { LovModule } from '../lov/lov.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
    ]), RoleModule,
    RolePermissionsModule,
    AttributeModule,
    LovModule,

  ], controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule { }

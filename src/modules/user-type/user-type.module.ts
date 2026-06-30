import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserTypeController } from './user-type.controller';
import { UserTypeService } from './user-type.service';
import { UserType } from './entities/user-type.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserType,
    ]),
  ],
  controllers: [
    UserTypeController,
  ],
  providers: [
    UserTypeService,
  ],
  exports: [
    UserTypeService,
  ],
})
export class UserTypeModule {}
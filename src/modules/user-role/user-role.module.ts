import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from './entities/user-role.entity';
import { UserRoleService } from './user-role.service';
import { AuditModule } from '../../audit/audit.module';

@Module({
  imports: [AuditModule, TypeOrmModule.forFeature([UserRole])],
  providers: [UserRoleService],
  exports: [UserRoleService],
})
export class UserRoleModule {}

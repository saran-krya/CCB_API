import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from './entities/user-role.entity';
import { UserRoleService } from './user-role.service';
import { AuditModule } from '../../audit/audit.module';
import { IamModule } from '../iam/iam.module';

@Module({
  // IamModule (a leaf: it imports no user/role module) provides the assignment boundary UserRoleService enforces on every grant.
  imports: [AuditModule, IamModule, TypeOrmModule.forFeature([UserRole])],
  providers: [UserRoleService],
  exports: [UserRoleService],
})
export class UserRoleModule {}

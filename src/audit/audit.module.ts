import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../modules/user/entities/user.entity';
import { AuditLogController } from './audit-log.controller';
import { AuditLogQueryService } from './audit-log-query.service';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

// `User` is registered only so the read side can show WHO performed an entry (a join on performed_by); nothing here writes to it.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, User])],
  controllers: [AuditLogController],
  providers: [AuditService, AuditLogQueryService],
  exports: [AuditService, AuditLogQueryService],
})
export class AuditModule {}

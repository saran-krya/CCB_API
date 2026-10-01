import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LovModule } from '../lov/lov.module';
import { Property } from '../property/entities/property.entity';
import { User } from '../user/entities/user.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { FieldInspectionRequest } from './entities/field-inspection-request.entity';
import { FieldInspectionController } from './field-inspection.controller';
import { FieldInspectionService } from './field-inspection.service';
import { UserRoleModule } from '../user-role/user-role.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FieldInspectionRequest, Property, User, MeterReading]),
    LovModule,
    UserRoleModule,
  ],
  controllers: [FieldInspectionController],
  providers: [FieldInspectionService],
  exports: [FieldInspectionService],
})
export class FieldInspectionModule {}

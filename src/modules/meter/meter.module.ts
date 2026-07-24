import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeModule } from '../attribute/attribute.module';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { User } from '../user/entities/user.entity';
import { MasterMeter } from './entities/master-meter.entity';
import { SubMeter } from './entities/sub-meter.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { MeterController } from './meter.controller';
import { MeterService } from './meter.service';

@Module({
  imports: [
    // MeterReading is already registered in SftpModule too — TypeORM allows
    // the same entity registered in multiple modules' forFeature() calls,
    // both just point at the same underlying repository/table. Registered
    // here (read-only queries only) so MeterService never has to import
    // anything from SftpModule — keeps the two modules fully decoupled.
    TypeOrmModule.forFeature([MasterMeter, SubMeter, Community, Property, Unit, User, MeterReading]),
    AttributeModule,
  ],
  controllers: [MeterController],
  providers: [MeterService],
  exports: [MeterService],
})
export class MeterModule {}

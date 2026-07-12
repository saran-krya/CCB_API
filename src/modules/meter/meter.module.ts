import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeModule } from '../attribute/attribute.module';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { MasterMeter } from './entities/master-meter.entity';
import { SubMeter } from './entities/sub-meter.entity';
import { MeterController } from './meter.controller';
import { MeterService } from './meter.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MasterMeter, SubMeter, Community, Property, Unit]),
    AttributeModule,
  ],
  controllers: [MeterController],
  providers: [MeterService],
  exports: [MeterService],
})
export class MeterModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeModule } from '../attribute/attribute.module';
import { LovModule } from '../lov/lov.module';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { TariffTier } from './entities/tariff-tier.entity';
import { Tariff } from './entities/tariff.entity';
import { TariffController } from './tariff.controller';
import { TariffSchedulerService } from './tariff-scheduler.service';
import { TariffService } from './tariff.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tariff, TariffTier, Property, Unit]), AttributeModule, LovModule],
  controllers: [TariffController],
  providers: [TariffService, TariffSchedulerService],
  exports: [TariffService],
})
export class TariffModule {}

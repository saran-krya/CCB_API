import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { TariffTier } from './entities/tariff-tier.entity';
import { Tariff } from './entities/tariff.entity';
import { TariffController } from './tariff.controller';
import { TariffService } from './tariff.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tariff, TariffTier, Property, Unit])],
  controllers: [TariffController],
  providers: [TariffService],
  exports: [TariffService],
})
export class TariffModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LovCategory } from './entities/lov-category.entity';
import { LovValue } from './entities/lov-value.entity';
import { LovController } from './lov.controller';
import { LovService } from './lov.service';

@Module({
  imports: [TypeOrmModule.forFeature([LovValue, LovCategory])],
  controllers: [LovController],
  providers: [LovService],
  exports: [LovService],
})
export class LovModule {}

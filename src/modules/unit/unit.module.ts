import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyModule } from '../property/property.module';
import { CustomerModule } from '../customer/customer.module';
import { Unit } from './entities/unit.entity';
import { UnitController } from './unit.controller';
import { UnitService } from './unit.service';

// forwardRef with CustomerModule: CustomerModule already imports UnitModule (a Customer's own unit
// FK needs UnitService.findOneEntity), and UnitService.findOne now calls
// CustomerService.findByUnitId to compose the Owner/Tenant summary directly onto UnitDetailDto (see
// that method's own doc comment) — a genuine mutual dependency, not something to design around.
@Module({
  imports: [TypeOrmModule.forFeature([Unit]), PropertyModule, forwardRef(() => CustomerModule)],
  controllers: [UnitController],
  providers: [UnitService],
  exports: [UnitService],
})
export class UnitModule {}

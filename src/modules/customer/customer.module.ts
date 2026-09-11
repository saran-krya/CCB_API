import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnitModule } from '../unit/unit.module';
import { RegistrationRequestModule } from '../registration-request/registration-request.module';
import { CustomerActivationToken } from './entities/customer-activation-token.entity';
import { Customer } from './entities/customer.entity';
import { Company } from './entities/company.entity';
import { CustomerActivationListener } from './listeners/customer-activation.listener';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

// forwardRef for both: UnitModule per its own existing comment on that mutual dependency, and
// RegistrationRequestModule for the same reason — RegistrationRequestModule already imports
// CustomerModule (RegistrationRequestService composes CustomerService), and now CustomerService
// itself needs RegistrationRequestService (CustomerService.activate() reads the Customer's own
// depositStatus — see that method's own doc comment on why account setup no longer unconditionally
// activates the account).
@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Company, CustomerActivationToken]),
    forwardRef(() => UnitModule),
    forwardRef(() => RegistrationRequestModule),
  ],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerActivationListener],
  exports: [CustomerService],
})
export class CustomerModule {}

import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeModule } from '../attribute/attribute.module';
import { BillingCycleModule } from '../billing-cycle/billing-cycle.module';
import { CustomerModule } from '../customer/customer.module';
import { LovModule } from '../lov/lov.module';
import { RegistrationDocumentRuleModule } from '../registration-document-rule/registration-document-rule.module';
import { TariffModule } from '../tariff/tariff.module';
import { UnitModule } from '../unit/unit.module';
import { RegistrationDemand } from './entities/registration-demand.entity';
import { RegistrationDocument } from './entities/registration-document.entity';
import { RegistrationRequest } from './entities/registration-request.entity';
import { RegistrationVersionSnapshot } from './entities/registration-version-snapshot.entity';
import { RegistrationWorkflowHistoryEntry } from './entities/registration-workflow-history.entity';
import { RegistrationCustomerDetail } from './entities/registration-customer-detail.entity';
import { RegistrationCompanyDetail } from './entities/registration-company-detail.entity';
import { RegistrationRequestUnit } from './entities/registration-request-unit.entity';
import { RegistrationRequestPropertyBilling } from './entities/registration-request-property-billing.entity';
import { RegistrationPaymentMethod } from './entities/registration-payment-method.entity';
import { RegistrationDeposit } from './entities/registration-deposit.entity';
import { RegistrationRequestController } from './registration-request.controller';
import { RegistrationRequestService } from './registration-request.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RegistrationRequest,
      RegistrationDocument,
      RegistrationDemand,
      RegistrationWorkflowHistoryEntry,
      RegistrationVersionSnapshot,
      RegistrationCustomerDetail,
      RegistrationCompanyDetail,
      RegistrationRequestUnit,
      RegistrationRequestPropertyBilling,
      RegistrationPaymentMethod,
      RegistrationDeposit,
    ]),
    TariffModule,
    BillingCycleModule,
    AttributeModule,
    RegistrationDocumentRuleModule,
    // forwardRef: CustomerModule now imports RegistrationRequestModule back (CustomerService.
    // activate() needs RegistrationRequestService.getMyDepositStatus — see that method's own doc
    // comment) — a genuine mutual dependency, same pattern as the existing CustomerModule/UnitModule
    // cycle (see UnitModule's own comment on that one).
    forwardRef(() => CustomerModule),
    LovModule,
    UnitModule,
  ],
  controllers: [RegistrationRequestController],
  providers: [RegistrationRequestService],
  exports: [RegistrationRequestService],
})
export class RegistrationRequestModule {}

import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { CommunityModule } from '../community/community.module';
import { PropertyModule } from '../property/property.module';
import { UnitModule } from '../unit/unit.module';
import { MeterModule } from '../meter/meter.module';
import { RegistrationRequestModule } from '../registration-request/registration-request.module';
import { LovModule } from '../lov/lov.module';
import { AttributeModule } from '../attribute/attribute.module';
import { BillingManagementModule } from '../billing-management/billing-management.module';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';

/**
 * Composes existing modules only — CustomerPortalService reuses CommunityService/PropertyService/
 * UnitService/MeterService/RegistrationRequestService/CustomerService/LovService/AttributeService/
 * BillingManagementService exactly as staff controllers do; this module adds zero new entities/
 * repositories, only the ownership/exposure-scoping layer on top (see CustomerPortalService's own
 * doc comment — LovService/AttributeService are added specifically for getMyRegistrationConfig,
 * which reads the SAME LOV categories and attribute keys the staff-only /lov and /attributes
 * endpoints serve, just composed into one customer-safe response instead of exposing those generic
 * endpoints directly). BillingManagementModule is added the same way, for getMyInvoices/getMyInvoice
 * — reuses BillingManagementService.findAll/findOne exactly as BillingManagementController itself
 * does, never a second, parallel Bill query — BillingManagementController's own doc comment already
 * anticipated this exact reuse ("remain as real, RBAC-gated backend capabilities for a future
 * customer/invoice-facing screen to reuse"). No circular import: BillingManagementModule and its own
 * dependencies (TariffModule, CustomerModule, AuditModule) never import CustomerPortalModule.
 */
@Module({
  imports: [
    CustomerModule,
    CommunityModule,
    PropertyModule,
    UnitModule,
    MeterModule,
    RegistrationRequestModule,
    LovModule,
    AttributeModule,
    BillingManagementModule,
  ],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}

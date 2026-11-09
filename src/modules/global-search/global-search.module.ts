import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermissionsModule } from '../role-permissions/role-permissions.module';
import { BillingManagementModule } from '../billing-management/billing-management.module';

import { User } from '../user/entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { Policy } from '../iam/entities/policy.entity';
import { Customer } from '../customer/entities/customer.entity';
import { RegistrationRequest } from '../registration-request/entities/registration-request.entity';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { MasterMeter } from '../meter/entities/master-meter.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { Bill } from '../billing-management/entities/bill.entity';
import { TariffVersion } from '../tariff/entities/tariff-version.entity';
import { BillingCycleMaster } from '../billing-cycle/entities/billing-cycle-master.entity';

import { GlobalSearchController } from './global-search.controller';
import { GlobalSearchService } from './global-search.service';
import { GLOBAL_SEARCH_PROVIDERS } from './global-search.constants';

import { UserSearchProvider } from './providers/user-search.provider';
import { RoleSearchProvider } from './providers/role-search.provider';
import { PolicySearchProvider } from './providers/policy-search.provider';
import { CustomerSearchProvider } from './providers/customer-search.provider';
import { RegistrationRequestSearchProvider } from './providers/registration-request-search.provider';
import { CommunitySearchProvider } from './providers/community-search.provider';
import { PropertySearchProvider } from './providers/property-search.provider';
import { UnitSearchProvider } from './providers/unit-search.provider';
import { MasterMeterSearchProvider } from './providers/master-meter-search.provider';
import { SubMeterSearchProvider } from './providers/sub-meter-search.provider';
import { BillSearchProvider } from './providers/bill-search.provider';
import { TariffSearchProvider } from './providers/tariff-search.provider';
import { BillingCycleSearchProvider } from './providers/billing-cycle-search.provider';

/**
 * Global Search — a modular provider registry, not one big cross-entity query service. Adding a newly
 * searchable entity later means: write one class implementing GlobalSearchProvider (see
 * interfaces/search-provider.interface.ts), add its entity to the TypeOrmModule.forFeature list below if
 * it isn't already registered by another module imported here, and add the class to BOTH the
 * `providers` array and the GLOBAL_SEARCH_PROVIDERS factory's own list immediately below it. Nothing
 * else in this feature — GlobalSearchService, GlobalSearchController, every other existing provider —
 * ever changes for that.
 *
 * RolePermissionsModule is imported for RolePermissionsService (GlobalSearchService's own authorization
 * check — see its doc comment). BillingManagementModule is imported only because BillSearchProvider
 * reuses BillingManagementService.getDisplayStatus rather than re-deriving "Overdue" itself.
 */
const PROVIDERS = [
  UserSearchProvider,
  RoleSearchProvider,
  PolicySearchProvider,
  CustomerSearchProvider,
  RegistrationRequestSearchProvider,
  CommunitySearchProvider,
  PropertySearchProvider,
  UnitSearchProvider,
  MasterMeterSearchProvider,
  SubMeterSearchProvider,
  BillSearchProvider,
  TariffSearchProvider,
  BillingCycleSearchProvider,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Role,
      Policy,
      Customer,
      RegistrationRequest,
      Community,
      Property,
      Unit,
      MasterMeter,
      SubMeter,
      Bill,
      TariffVersion,
      BillingCycleMaster,
    ]),
    RolePermissionsModule,
    BillingManagementModule,
  ],
  controllers: [GlobalSearchController],
  providers: [
    GlobalSearchService,
    ...PROVIDERS,
    {
      provide: GLOBAL_SEARCH_PROVIDERS,
      useFactory: (...providers: unknown[]) => providers,
      inject: PROVIDERS,
    },
  ],
})
export class GlobalSearchModule {}

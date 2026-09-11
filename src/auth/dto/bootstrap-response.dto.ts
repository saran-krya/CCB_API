import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerAccountStatus } from '../../modules/customer/entities/customer.entity';

class BootstrapRoleDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

class BootstrapProfileDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ nullable: true })
  firstName?: string | null;

  @ApiProperty({ nullable: true })
  middleName?: string | null;

  @ApiProperty({ nullable: true })
  lastName?: string | null;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  employeeCode?: string | null;

  @ApiProperty({ nullable: true })
  designation?: string | null;

  @ApiProperty({ type: BootstrapRoleDto })
  role!: BootstrapRoleDto;

  @ApiProperty({ nullable: true })
  themeMode!: string | null;

  @ApiProperty({ nullable: true })
  navTheme!: string | null;

  @ApiProperty({ nullable: true })
  preferredLanguageCode!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  permissions!: unknown;
}

/**
 * Customer session's own context.profile shape — deliberately NOT BootstrapProfileDto: no
 * role/permissions (a Customer has no Role row and no RBAC), and no staff-only fields
 * (employeeCode/designation/themeMode/navTheme — none of which exist on Customer). Reuses
 * CustomerService.findOne's existing self-profile fields; no new query logic.
 */
class BootstrapCustomerProfileDto {
  @ApiProperty()
  id!: number;

  @ApiPropertyOptional({ nullable: true })
  businessCode?: string | null;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  mobile?: string | null;

  @ApiProperty({ enum: CustomerAccountStatus })
  accountStatus!: CustomerAccountStatus;
}

class BootstrapLanguageDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true })
  direction!: string | null;

  @ApiProperty({ nullable: true })
  localeCode!: string | null;
}

class BootstrapSessionConfigDto {
  @ApiProperty({ description: 'Minutes of inactivity before the client should force-logout the user' })
  idleTimeoutMinutes!: number;
}

/**
 * Everything the frontend needs to render the authenticated app shell, in one response —
 * session/idle-timeout config and the active language list are shared by BOTH session kinds;
 * `type` tells the frontend which ONE of `profile` (staff, incl. RBAC permission tree) /
 * `customerProfile` (customer, no role/permissions — a Customer has no Role row) is populated.
 * Composes the existing UserService/CustomerService/AttributeService/LovService methods; no new
 * data sources, no duplicated logic.
 */
export class BootstrapResponseDto {
  @ApiProperty({ enum: ['staff', 'customer'] })
  type!: 'staff' | 'customer';

  @ApiPropertyOptional({ type: BootstrapProfileDto, description: 'Populated only when type is "staff"' })
  profile?: BootstrapProfileDto;

  @ApiPropertyOptional({ type: BootstrapCustomerProfileDto, description: 'Populated only when type is "customer"' })
  customerProfile?: BootstrapCustomerProfileDto;

  @ApiPropertyOptional({
    enum: ['restricted', 'full'],
    description:
      'Populated only when type is "customer". "restricted" means the registration/deposit ' +
      'sub-process is not yet resolved (see RegistrationDepositStatus\'s own isDepositResolved rule) ' +
      '— the frontend should show only the registration-completion flow, never the normal Customer ' +
      'Portal nav. UX guidance only: CustomerAccessGuard enforces the real boundary server-side on ' +
      'every request regardless of what the frontend does with this field.',
  })
  portalAccess?: 'restricted' | 'full';

  @ApiProperty({ type: BootstrapSessionConfigDto })
  sessionConfig!: BootstrapSessionConfigDto;

  @ApiProperty({ type: [BootstrapLanguageDto] })
  languages!: BootstrapLanguageDto[];
}

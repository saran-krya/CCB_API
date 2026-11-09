import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_ORG_KEY = 'allowSuspendedOrg';

/**
 * Marks a route a tenant session may still call while its Organization is SUSPENDED or INACTIVE —
 * reserved for a small, explicit allowlist the same way @AllowPendingPasswordChange() is (signing
 * out, read-only "who am I" calls the app shell needs to show a suspended-organization notice). Every
 * other tenant route answers 403 until a SUPER_ADMIN reactivates the organization
 * (OrganizationStatusGuard). Never apply this to a route that returns or changes business data.
 */
export const AllowSuspendedOrg = () => SetMetadata(ALLOW_SUSPENDED_ORG_KEY, true);

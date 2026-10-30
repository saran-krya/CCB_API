import { ApiProperty } from '@nestjs/swagger';

/** The Action codes the authenticated staff principal actually holds via its Roles' attached
 *  Policies — the UNION across ALL of the user's current roles, exactly what PermissionGuard checks
 *  against (IamService.getActionCodesGrantedByPoliciesForRoles), never the legacy role_permissions
 *  tree. Empty for a customer session (Customers have no Role). */
export class MyActionCodesDto {
  @ApiProperty({ type: [String], description: 'Every Action code granted to this principal across all of its current Roles via their attached Policies' })
  actionCodes!: string[];
}

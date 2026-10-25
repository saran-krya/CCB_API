import { ApiProperty } from '@nestjs/swagger';

/** The Action codes the authenticated staff principal's Role actually holds via its attached
 *  Policies — exactly what PermissionGuard checks against (IamService.getActionCodesGrantedByPolicies),
 *  never the legacy role_permissions tree. Empty for a customer session (Customers have no Role). */
export class MyActionCodesDto {
  @ApiProperty({ type: [String], description: 'Every Action code this principal\'s Role is granted via its attached Policies' })
  actionCodes!: string[];
}

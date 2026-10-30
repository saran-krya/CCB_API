import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CustomerAccessible } from '../common/decorators/customer-accessible.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import { AttributeService } from '../modules/attribute/attribute.service';
import { RolePermissionsService } from '../modules/role-permissions/role-permissions.service';
import { AuthenticatedUser, AuthPrincipal } from './interfaces/authenticated-user.interface';
import { DeviceContext } from './interfaces/device-context.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserDeviceDto } from './dto/device-response.dto';
import { LoginHistoryDto } from './dto/login-history-response.dto';
import { SessionConfigDto } from './dto/session-config-response.dto';
import { BootstrapResponseDto } from './dto/bootstrap-response.dto';
import { MyActionCodesDto } from './dto/my-action-codes-response.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminResetPasswordResponseDto } from './dto/admin-reset-password-response.dto';
import { DisableSigninAccessDto } from './dto/disable-signin-access.dto';
import { SigninAccessStatusResponseDto } from './dto/signin-access-status-response.dto';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly attributes: AttributeService,
    private readonly rolePermissions: RolePermissionsService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiOkResponse({ type: TokenResponseDto })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<TokenResponseDto> {
    return this.auth.login(dto, this.extractDeviceCtx(req));
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new access + refresh token pair' })
  @ApiOkResponse({ type: TokenResponseDto })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<TokenResponseDto> {
    return this.auth.refresh(dto.refreshToken, this.extractDeviceCtx(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the refresh token and deactivate device (server-side logout)' })
  @ApiNoContentResponse({ description: 'Refresh token revoked' })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @Public()
  @Get('sso')
  @Redirect()
  @ApiOperation({ summary: 'Redirect to configured OAuth/SSO provider' })
  ssoRedirect(@Query('state') state?: string) {
    return { url: this.auth.getSsoAuthorizationUrl(state) };
  }

  @Get('me')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated principal' })
  me(@CurrentUser() user: AuthenticatedUser | undefined) {
    return user;
  }

  // These four are self-service session-management operations ("my own devices/history"), common
  // to both identity types by nature — never staff business logic — so they're kept as ONE set of
  // routes rather than duplicated per identity, exactly like login/refresh/logout/context.
  // `principal.type` (never trusted from the client) picks which table (users vs customers) the
  // service filters against, since userId alone collides across the two independent id spaces —
  // see RefreshToken.principalType's own doc comment.
  @Get('devices')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active devices for the authenticated principal (staff or customer)' })
  @ApiOkResponse({ type: [UserDeviceDto] })
  getDevices(
    @CurrentUser() principal: AuthPrincipal,
    @Req() req: Request,
  ): Promise<UserDeviceDto[]> {
    const deviceId = req.headers['x-device-id'] as string | undefined;
    return this.auth.getDevices(principal.type === 'customer' ? 'customer' : 'staff', principal.sub, deviceId);
  }

  @Delete('devices/:deviceId')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log out a specific device by its deviceId' })
  @ApiNoContentResponse({ description: 'Device logged out' })
  removeDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<void> {
    return this.auth.logoutDevice(principal.type === 'customer' ? 'customer' : 'staff', deviceId, principal.sub);
  }

  @Post('logout-all')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all devices and refresh tokens for the authenticated principal' })
  @ApiNoContentResponse({ description: 'All devices logged out' })
  logoutAll(@CurrentUser() principal: AuthPrincipal): Promise<void> {
    return this.auth.logoutAll(principal.type === 'customer' ? 'customer' : 'staff', principal.sub);
  }

  @Patch('change-password')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Change the authenticated principal's own password — requires the current password, revokes " +
      'every OTHER active device/session (the caller\'s own current session survives)',
  })
  @ApiNoContentResponse({ description: 'Password changed; other sessions revoked' })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() principal: AuthPrincipal,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.changePassword(principal, dto, this.extractDeviceCtx(req));
  }

  @Get('login-history')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get login/logout history for the authenticated principal' })
  @ApiOkResponse({ type: [LoginHistoryDto] })
  getLoginHistory(@CurrentUser() principal: AuthPrincipal): Promise<LoginHistoryDto[]> {
    return this.auth.getLoginHistory(principal.type === 'customer' ? 'customer' : 'staff', principal.sub);
  }

  @Get('session-config')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Session-related config for the authenticated user (e.g. idle timeout)' })
  @ApiOkResponse({ type: SessionConfigDto })
  async getSessionConfig(): Promise<SessionConfigDto> {
    const raw = await this.attributes.getValueByKey('SESSION_TIMEOUT_MINUTES');
    if (raw === null) {
      throw new NotFoundException('SESSION_TIMEOUT_MINUTES is not configured');
    }
    return { idleTimeoutMinutes: Number(raw) };
  }

  // Admin-on-ANOTHER-user actions — the "Manage sign-in access" dialog. Unlike the self-service
  // session block above (always @CurrentUser()-scoped, no :id), these four all take an explicit
  // target :id, are gated behind RESET_USER_PASSWORD (a dedicated permission, separate from
  // EDIT_USER, so an org can grant profile-editing without granting credential control over other
  // accounts), and are deliberately placed under `users/:id/...` rather than inside the bare
  // `devices`/`login-history` paths above, so the two concerns are never confusable at the routing
  // level. Always 'staff' — this controller has no customer-equivalent of this feature.
  @Get('users/:id/signin-access')
  @Permission('RESET_USER_PASSWORD')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Sign-in access status for ANOTHER user (admin view) — never exposes the password itself" })
  @ApiOkResponse({ type: SigninAccessStatusResponseDto })
  getSigninAccessStatus(@Param('id') id: number): Promise<SigninAccessStatusResponseDto> {
    return this.auth.getSigninAccessStatus(id);
  }

  @Patch('users/:id/reset-password')
  @Permission('RESET_USER_PASSWORD')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Admin-triggered password reset for ANOTHER user — autogenerate or set a custom password, " +
      'optionally forcing a mandatory change at next sign-in and/or revoking active sessions',
  })
  @ApiOkResponse({ type: AdminResetPasswordResponseDto })
  adminResetPassword(
    @Param('id') id: number,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<AdminResetPasswordResponseDto> {
    return this.auth.adminResetPassword(id, dto, principal.sub);
  }

  @Patch('users/:id/disable-signin-access')
  @Permission('RESET_USER_PASSWORD')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Admin-triggered 'Disable sign-in access' for ANOTHER user — invalidates their current " +
      "password without touching the account's active/enabled status",
  })
  disableSigninAccess(
    @Param('id') id: number,
    @Body() dto: DisableSigninAccessDto,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<{ sessionsRevoked: boolean }> {
    return this.auth.disableSigninAccess(id, !!dto.revokeSessions, principal.sub);
  }

  @Post('users/:id/revoke-sessions')
  @Permission('RESET_USER_PASSWORD')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Admin-triggered 'Revoke active sign-in sessions' for ANOTHER user" })
  @ApiNoContentResponse({ description: 'Sessions revoked' })
  adminRevokeSessions(@Param('id') id: number, @CurrentUser() principal: AuthPrincipal): Promise<void> {
    return this.auth.adminRevokeSessions(id, principal.sub);
  }

  @Get('context')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Everything the frontend needs to render the authenticated app shell in one call — handles ' +
      'both staff and customer sessions (see BootstrapResponseDto\'s own doc comment)',
  })
  @ApiOkResponse({ type: BootstrapResponseDto })
  getContext(@CurrentUser() principal: AuthPrincipal): Promise<BootstrapResponseDto> {
    return this.auth.bootstrap(principal);
  }

  @Get('me/actions')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "The authenticated principal's own Policy-granted Action codes — the UNION across all of " +
      "their current roles, the exact same set PermissionGuard checks against, never the legacy " +
      'permission tree. Drives frontend features like Policy-based sidebar visibility without ' +
      'duplicating authorization logic client-side. Always an empty array for a customer session ' +
      '(Customers have no Role/Policy).',
  })
  @ApiOkResponse({ type: MyActionCodesDto })
  async getMyActionCodes(@CurrentUser() principal: AuthPrincipal): Promise<MyActionCodesDto> {
    if (principal.type === 'customer') return { actionCodes: [] };
    // Live role set (see PermissionGuard for why `roleIds` and the `?? [roleId]` fallback).
    const actionCodes = await this.rolePermissions.getMyActionCodesForRoles(
      principal.roleIds ?? [principal.roleId],
      principal.sub,
    );
    return { actionCodes };
  }

  @Get('me/nav-catalog')
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'The full, static Module/SubModule/Screen navigation catalog (names, icons, URLs, hierarchy), ' +
      "every hasAccess forced true — RolePermissionsService.getAllMenus()'s own existing unfiltered-" +
      'structure output, now reachable by any authenticated staff session instead of only its prior ' +
      "sole consumer, SUPER_ADMIN's Role permission-tree editor. Added because the legacy " +
      'role_permissions tree (GET /auth/context\'s own profile.permissions) only lists a module/' +
      'submodule for a role that already has at least one legacy grant row for it — so a role ' +
      'configured purely through Policies (this capability\'s whole point) can have zero such rows ' +
      'and see an empty sidebar shape despite holding real Policy grants. This route supplies ' +
      'STRUCTURE ONLY, never an authorization decision — real visibility still comes from ' +
      'GET /auth/me/actions. Always an empty array for a customer session.',
  })
  async getMyNavCatalog(@CurrentUser() principal: AuthPrincipal) {
    if (principal.type === 'customer') return [];
    return this.rolePermissions.getAllMenus();
  }

  private extractDeviceCtx(req: Request): DeviceContext {
    return {
      deviceId: req.headers['x-device-id'] as string | undefined,
      userAgent: req.headers['user-agent'],
      ipAddress:
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip,
    };
  }
}

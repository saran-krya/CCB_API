import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CustomerAccessible } from '../common/decorators/customer-accessible.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import { StaffPermission } from '../common/decorators/staff-permission.decorator';
import { Authenticated } from '../common/decorators/authenticated.decorator';
import { AllowPendingPasswordChange } from '../common/decorators/allow-pending-password-change.decorator';
import { actorFrom } from '../common/security/actor';
import { strictRateLimit } from '../common/security/throttle-settings';
import { durationToMs, readBoolean, resolveRefreshCookieSettings } from '../config/runtime-config';
import { RolePermissionsService } from '../modules/role-permissions/role-permissions.service';
import { AuthenticatedUser, AuthPrincipal } from './interfaces/authenticated-user.interface';
import { DeviceContext } from './interfaces/device-context.interface';
import { AuthService } from './auth.service';
import { clearRefreshCookie, hasClientMarker, readCookie, setRefreshCookie } from './refresh-cookie';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserDeviceDto } from './dto/device-response.dto';
import { LoginHistoryDto } from './dto/login-history-response.dto';
import { LoginHistoryQueryDto } from './dto/login-history-query.dto';
import { SessionConfigDto } from './dto/session-config-response.dto';
import { BootstrapResponseDto } from './dto/bootstrap-response.dto';
import { MyActionCodesDto } from './dto/my-action-codes-response.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminResetPasswordResponseDto } from './dto/admin-reset-password-response.dto';
import { DisableSigninAccessDto } from './dto/disable-signin-access.dto';
import { SigninAccessStatusResponseDto } from './dto/signin-access-status-response.dto';
import { PRINCIPAL_TYPE, DEVICE_ID_HEADER } from '../common/constants/auth.constants';
import { sanitizeDeviceId } from './device-info.util';
import { ERROR_MESSAGES } from '../common/constants/error-messages.constants';
import { ACTION_CODES } from '../common/constants/action-codes.constants';

/**
 * Auth routes. Authorization here is explicit on every route (deny-by-default): the four public ones
 * (login, refresh, logout, sso) say @Public; the self-service ones say @Authenticated (+ @CustomerAccessible
 * where a customer session may call them); the admin-on-another-user ones say @Permission.
 *
 * REFRESH TOKEN DELIVERY: the refresh token is set as an HttpOnly cookie (see refresh-cookie.ts) and is NOT
 * returned in the JSON body, so page scripts can never read it. `AUTH_REFRESH_IN_BODY=true` is the opt-in
 * compatibility switch for non-browser API clients: the token is then also returned in the body and accepted
 * from it. A refresh/logout that relies on the cookie must carry the `X-CCB-Client` marker header (CSRF
 * defence — see CLIENT_MARKER_HEADER).
 */
@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rolePermissions: RolePermissionsService,
  ) {}

  @Public()
  @Post('login')
  @Throttle(strictRateLimit())
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiOkResponse({ type: TokenResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    return this.deliverTokens(res, await this.auth.login(dto, this.extractDeviceCtx(req)));
  }

  @Public()
  @Post('refresh')
  @Throttle(strictRateLimit())
  @ApiOperation({ summary: 'Exchange the refresh token (HttpOnly cookie) for a new access token, rotating the refresh token' })
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const token = this.resolveRefreshToken(req, dto, true);
    return this.deliverTokens(res, await this.auth.refresh(token, this.extractDeviceCtx(req)));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the refresh token, deactivate the device and clear the cookie (server-side logout)' })
  @ApiNoContentResponse({ description: 'Refresh token revoked' })
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const settings = resolveRefreshCookieSettings(process.env);
    const token = this.resolveRefreshToken(req, dto, false);
    clearRefreshCookie(res, settings);
    if (token) await this.auth.logout(token);
  }

  @Public()
  @Get('sso')
  @Redirect()
  @ApiOperation({ summary: 'Redirect to configured OAuth/SSO provider' })
  ssoRedirect(@Query('state') state?: string) {
    return { url: this.auth.getSsoAuthorizationUrl(state) };
  }

  @Get('me')
  @Authenticated()
  @AllowPendingPasswordChange()
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
  //
  // On the Settings > Security routes below a STAFF session additionally needs the page's own grant (@StaffPermission —
  // VIEW to read, UPDATE to change); a customer session is unaffected and still sees only its own sessions and history.
  @Get('devices')
  @Authenticated()
  @StaffPermission(ACTION_CODES.SETTINGS_SESSIONS_VIEW)
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the signed-in sessions (one row per device) of the authenticated principal (staff or customer)' })
  @ApiOkResponse({ type: [UserDeviceDto] })
  getDevices(
    @CurrentUser() principal: AuthPrincipal,
    @Req() req: Request,
  ): Promise<UserDeviceDto[]> {
    return this.auth.getDevices(principal, sanitizeDeviceId(req.headers[DEVICE_ID_HEADER]));
  }

  @Delete('devices/:deviceId')
  @Authenticated()
  @StaffPermission(ACTION_CODES.SETTINGS_SESSIONS_UPDATE)
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out a specific device by its deviceId — every session on it ends' })
  @ApiNoContentResponse({ description: 'Device logged out' })
  removeDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<void> {
    return this.auth.logoutDevice(principal, deviceId);
  }

  @Post('logout-all')
  @Authenticated()
  @StaffPermission(ACTION_CODES.SETTINGS_SESSIONS_UPDATE)
  @AllowPendingPasswordChange()
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all devices and refresh tokens for the authenticated principal' })
  @ApiNoContentResponse({ description: 'All devices logged out' })
  logoutAll(@CurrentUser() principal: AuthPrincipal): Promise<void> {
    return this.auth.logoutEverywhere(principal);
  }

  // "Sign out of every other session": the session making the request is identified by the access token's own `sid`, so
  // nothing a client sends can keep another session alive. Only a token issued before `sid` existed falls back to the
  // validated X-Device-Id label, and without that either the caller's own session cannot be told apart from the rest —
  // the request is then refused rather than risk signing the caller out too (logout-all above revokes everything).
  @Post('logout-others')
  @Authenticated()
  @StaffPermission(ACTION_CODES.SETTINGS_SESSIONS_UPDATE)
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every OTHER session of the authenticated principal — the session making the request survives' })
  @ApiNoContentResponse({ description: 'All other sessions logged out' })
  logoutOthers(@CurrentUser() principal: AuthPrincipal, @Req() req: Request): Promise<void> {
    const deviceId = sanitizeDeviceId(req.headers[DEVICE_ID_HEADER]);
    if (!principal.sid && !deviceId) throw new BadRequestException('This session could not be identified, so the other sessions were not revoked.');
    return this.auth.logoutOtherSessions(principal, deviceId);
  }

  @Patch('change-password')
  @Authenticated()
  // A voluntary change needs the Change Password grant; the forced first-login / admin-reset change does not (see StaffPermission).
  @StaffPermission(ACTION_CODES.SETTINGS_PASSWORD_UPDATE)
  @AllowPendingPasswordChange()
  @CustomerAccessible({ allowRestricted: true })
  @Throttle(strictRateLimit())
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Change the authenticated principal's own password — requires the current password (a wrong one counts toward " +
      'the sign-in lock-out), revokes ' +
      'every OTHER active device/session (the caller\'s own current session survives)',
  })
  @ApiNoContentResponse({ description: 'Password changed; other sessions revoked' })
  @ApiUnauthorizedResponse({ description: 'The current password is incorrect' })
  @ApiTooManyRequestsResponse({
    description: 'Too many failed attempts for this account or client IP (the same lock-out as sign-in); see Retry-After',
  })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() principal: AuthPrincipal,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.changePassword(principal, dto, this.extractDeviceCtx(req));
  }

  @Get('login-history')
  @Authenticated()
  @StaffPermission(ACTION_CODES.SETTINGS_LOGIN_HISTORY_VIEW)
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the most recent login/logout history (each row with a computed status) for the authenticated principal' })
  @ApiOkResponse({ type: [LoginHistoryDto] })
  getLoginHistory(@CurrentUser() principal: AuthPrincipal, @Query() query: LoginHistoryQueryDto): Promise<LoginHistoryDto[]> {
    return this.auth.getLoginHistory(principal.type === PRINCIPAL_TYPE.CUSTOMER ? PRINCIPAL_TYPE.CUSTOMER : PRINCIPAL_TYPE.STAFF, principal.sub, query.limit);
  }

  @Get('session-config')
  @Authenticated()
  @AllowPendingPasswordChange()
  @CustomerAccessible({ allowRestricted: true })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Session-related config for the authenticated user (e.g. idle timeout)' })
  @ApiOkResponse({ type: SessionConfigDto })
  getSessionConfig(): Promise<SessionConfigDto> {
    return this.auth.getSessionConfig();
  }

  // Admin-on-ANOTHER-user actions — the "Manage sign-in access" dialog. Unlike the self-service
  // session block above (always @CurrentUser()-scoped, no :id), these four all take an explicit
  // target :id, are gated behind RESET_USER_PASSWORD (a dedicated permission, separate from
  // EDIT_USER, so an org can grant profile-editing without granting credential control over other
  // accounts), and are deliberately placed under `users/:id/...` rather than inside the bare
  // `devices`/`login-history` paths above, so the two concerns are never confusable at the routing
  // level. Always 'staff' — this controller has no customer-equivalent of this feature.
  //
  // RESET_USER_PASSWORD carries NO authority over a SUPER_ADMIN account or over the actor's own: the
  // service refuses (403) to reset, disable or revoke a SUPER_ADMIN unless the actor is one, and refuses
  // all three on yourself (use the self-service flows, which prove it is really you).
  @Get('users/:id/signin-access')
  @Permission(ACTION_CODES.RESET_USER_PASSWORD)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Sign-in access status for ANOTHER user (admin view) — never exposes the password itself" })
  @ApiOkResponse({ type: SigninAccessStatusResponseDto })
  getSigninAccessStatus(@Param('id', ParseIntPipe) id: number): Promise<SigninAccessStatusResponseDto> {
    return this.auth.getSigninAccessStatus(id);
  }

  @Patch('users/:id/reset-password')
  @Permission(ACTION_CODES.RESET_USER_PASSWORD)
  @Throttle(strictRateLimit())
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Admin-triggered password reset for ANOTHER user — autogenerate or set a custom password, " +
      'optionally forcing a mandatory change at next sign-in and/or revoking active sessions',
  })
  @ApiOkResponse({ type: AdminResetPasswordResponseDto })
  adminResetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<AdminResetPasswordResponseDto> {
    return this.auth.adminResetPassword(id, dto, actorFrom(principal));
  }

  @Patch('users/:id/disable-signin-access')
  @Permission(ACTION_CODES.RESET_USER_PASSWORD)
  @Throttle(strictRateLimit())
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Admin-triggered 'Disable sign-in access' for ANOTHER user — invalidates their current " +
      "password without touching the account's active/enabled status",
  })
  disableSigninAccess(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DisableSigninAccessDto,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<{ sessionsRevoked: boolean }> {
    return this.auth.disableSigninAccess(id, !!dto.revokeSessions, actorFrom(principal));
  }

  @Post('users/:id/revoke-sessions')
  @Permission(ACTION_CODES.RESET_USER_PASSWORD)
  @Throttle(strictRateLimit())
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Admin-triggered 'Revoke active sign-in sessions' for ANOTHER user" })
  @ApiNoContentResponse({ description: 'Sessions revoked' })
  adminRevokeSessions(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<void> {
    return this.auth.adminRevokeSessions(id, actorFrom(principal));
  }

  @Post('users/:id/unlock-signin')
  @Permission(ACTION_CODES.RESET_USER_PASSWORD)
  @Throttle(strictRateLimit())
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Admin-triggered 'Unlock sign-in' for ANOTHER user — clears the failed-sign-in counters of the account (every client) so its owner can try again " +
      'at once. A locked client IP stays locked.',
  })
  adminUnlockSignin(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<{ countersCleared: number }> {
    return this.auth.adminUnlockSignin(id, actorFrom(principal));
  }

  @Get('context')
  @Authenticated()
  @AllowPendingPasswordChange()
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
  @Authenticated()
  @AllowPendingPasswordChange()
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
    if (principal.type === PRINCIPAL_TYPE.CUSTOMER) return { actionCodes: [] };
    // Live role set (see PermissionGuard for why `roleIds` and the `?? [roleId]` fallback).
    const actionCodes = await this.rolePermissions.getMyActionCodesForRoles(
      principal.roleIds ?? [principal.roleId],
      principal.sub,
    );
    return { actionCodes };
  }

  @Get('me/nav-catalog')
  @Authenticated()
  @AllowPendingPasswordChange()
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
    if (principal.type === PRINCIPAL_TYPE.CUSTOMER) return [];
    return this.rolePermissions.getAllMenus();
  }

  /**
   * Hands the new token pair to the client: the refresh token goes into the HttpOnly cookie and is stripped
   * from the body (unless AUTH_REFRESH_IN_BODY=true). Cookie settings come from the environment on each call
   * (cheap, and keeps this controller free of extra constructor dependencies).
   *
   * "Remember me" decides how long the cookie lives: a remembered session gets a PERSISTENT cookie (Max-Age = the
   * lifetime of the refresh token it holds, `refreshTokenExpiresIn`), every other session a browser-session cookie
   * with no Max-Age. A refresh goes through here too and carries the same flag, so the persistence never changes
   * while a session is being renewed.
   */
  private deliverTokens(res: Response, tokens: TokenResponseDto): TokenResponseDto {
    if (tokens.refreshToken) {
      const persistentForMs = tokens.rememberMe ? durationToMs(tokens.refreshTokenExpiresIn) : undefined;
      setRefreshCookie(res, tokens.refreshToken, resolveRefreshCookieSettings(process.env), persistentForMs);
    }
    if (readBoolean(process.env.AUTH_REFRESH_IN_BODY, false)) return tokens;
    const { refreshToken: _delivered, ...body } = tokens;
    return body;
  }

  /**
   * The refresh token for this request: from the body only when AUTH_REFRESH_IN_BODY allows it (non-browser
   * clients), otherwise from the HttpOnly cookie — and a cookie-borne token is honoured only together with the
   * `X-CCB-Client` marker header, so a hostile page cannot trigger a refresh/logout with the victim's cookie.
   * With `required`, a missing token is a 401; without it (logout) the caller just gets undefined.
   */
  private resolveRefreshToken(req: Request, dto: RefreshTokenDto | undefined, required: true): string;
  private resolveRefreshToken(req: Request, dto: RefreshTokenDto | undefined, required?: boolean): string | undefined;
  private resolveRefreshToken(req: Request, dto: RefreshTokenDto | undefined, required = true): string | undefined {
    if (dto?.refreshToken && readBoolean(process.env.AUTH_REFRESH_IN_BODY, false)) {
      return dto.refreshToken;
    }
    const cookie = readCookie(req, resolveRefreshCookieSettings(process.env).name);
    if (cookie) {
      if (!hasClientMarker(req)) {
        throw new ForbiddenException('Missing client header.');
      }
      return cookie;
    }
    if (required) throw new UnauthorizedException(ERROR_MESSAGES.INVALID_REFRESH_TOKEN);
    return undefined;
  }

  private extractDeviceCtx(req: Request): DeviceContext {
    return {
      // A grouping label only (validated; anything else is dropped) — never an identity, see sanitizeDeviceId.
      deviceId: sanitizeDeviceId(req.headers[DEVICE_ID_HEADER]),
      userAgent: req.headers['user-agent'],
      // `req.ip`, which Express derives honouring the TRUST_PROXY setting. Reading X-Forwarded-For
      // directly (as this used to) let any client forge the address recorded in login history and used
      // for lock-out/rate limiting.
      ipAddress: req.ip,
    };
  }
}

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
import { AttributeService } from '../modules/attribute/attribute.service';
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

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly attributes: AttributeService,
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

  private extractDeviceCtx(req: Request): DeviceContext {
    return {
      deviceId: req.headers['x-device-id'] as string | undefined,
      userAgent: req.headers['user-agent'],
      ipAddress:
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip,
    };
  }
}

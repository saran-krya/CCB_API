import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { DeviceContext } from './interfaces/device-context.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserDeviceDto } from './dto/device-response.dto';
import { LoginHistoryDto } from './dto/login-history-response.dto';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated principal' })
  me(@CurrentUser() user: AuthenticatedUser | undefined) {
    return user;
  }

  @Get('devices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active devices for the authenticated user' })
  @ApiOkResponse({ type: [UserDeviceDto] })
  getDevices(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserDeviceDto[]> {
    const deviceId = req.headers['x-device-id'] as string | undefined;
    return this.auth.getDevices(user.sub, deviceId);
  }

  @Delete('devices/:deviceId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log out a specific device by its deviceId' })
  @ApiNoContentResponse({ description: 'Device logged out' })
  removeDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.auth.logoutDevice(deviceId, user.sub);
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all devices and refresh tokens for the authenticated user' })
  @ApiNoContentResponse({ description: 'All devices logged out' })
  logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logoutAll(user.sub);
  }

  @Get('login-history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get login/logout history for the authenticated user' })
  @ApiOkResponse({ type: [LoginHistoryDto] })
  getLoginHistory(@CurrentUser() user: AuthenticatedUser): Promise<LoginHistoryDto[]> {
    return this.auth.getLoginHistory(user.sub);
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

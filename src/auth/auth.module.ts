import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PasswordChangeGuard } from '../common/guards/password-change.guard';
import { CustomerAccessGuard } from '../common/guards/customer-access.guard';
import { throttlerModuleOptions } from '../common/security/throttle-settings';
import { LoginAttemptsService } from './login-attempts.service';
import { SessionLivenessService } from './session-liveness.service';
import { UserModule } from '../modules/user/user.module';
import { CustomerModule } from '../modules/customer/customer.module';
import { AttributeModule } from '../modules/attribute/attribute.module';
import { RolePermissionsModule } from '../modules/role-permissions/role-permissions.module';
import { LovModule } from '../modules/lov/lov.module';
import { RegistrationRequestModule } from '../modules/registration-request/registration-request.module';
import { UserRoleModule } from '../modules/user-role/user-role.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserLoginHistory } from './entities/user-login-history.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ENV_KEY } from '../common/constants/env.constants';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    // Async so the limits are read AFTER ConfigModule has loaded the env file (this module is decorated
    // before AppModule's ConfigModule.forRoot runs).
    ThrottlerModule.forRootAsync({ useFactory: () => throttlerModuleOptions() }),
    TypeOrmModule.forFeature([RefreshToken, UserDevice, UserLoginHistory]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>(ENV_KEY.JWT_SECRET),
        signOptions: { expiresIn: config.getOrThrow<string>(ENV_KEY.JWT_EXPIRES_IN) },
      }),
    }),
    UserModule,
    CustomerModule,
    AttributeModule,
    RolePermissionsModule,
    LovModule,
    RegistrationRequestModule,
    UserRoleModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginAttemptsService,
    SessionLivenessService,
    JwtStrategy,
    // The global guard chain, in the order it runs (Nest applies APP_GUARD providers in declaration
    // order, and a guard that returns false stops the chain):
    //   1. rate limit per client IP — before anything touches the database, so a flood is cheap to refuse;
    //   2. authentication (JWT) — every non-@Public route;
    //   3. customer-portal gate (@CustomerAccessible) — a customer session may reach only opted-in routes;
    //   4. mandatory password change — a flagged staff user may reach only the change-password routes;
    //   5. @Roles; 6. @Permission / @Authenticated — staff authorization, deny-by-default.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CustomerAccessGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureHttpSecurity } from './common/security/configure-http-security';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { resolveAppEnvironment, resolveSwaggerEnabled } from './config/runtime-config';
import { APP_ENVIRONMENT } from './common/constants/env.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('API_PREFIX', 'api');
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // ConfigModule has already loaded the selected env file into process.env by the time the app exists.
  configureHttpSecurity(app, process.env);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new ResponseInterceptor(),
  );

  // Swagger UI and /docs-json describe every route, so they exist only where they are wanted: on by
  // default for a developer machine, off everywhere else unless SWAGGER_ENABLED=true is set explicitly.
  if (resolveSwaggerEnabled(process.env)) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('HVAC/BTU Metering Platform API')
      .setDescription('Enterprise backend APIs for Dubai apartment HVAC and BTU metering operations.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    if (resolveAppEnvironment(process.env.NODE_ENV) === APP_ENVIRONMENT.PRODUCTION) {
      logger.warn('Swagger UI is enabled (SWAGGER_ENABLED=true) in a production-like environment — it exposes the full API surface.');
    }
  }

  await app.listen(config.get<number>('PORT', 4000));
}

void bootstrap();

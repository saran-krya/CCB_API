import { Logger, RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureHttpSecurity } from './common/security/configure-http-security';
import { createProxyHeaderWarning } from './common/security/proxy-warning';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { judgeNodeRuntime } from './config/node-support';
import { resolveAppEnvironment, resolveSwaggerEnabled } from './config/runtime-config';
import { APP_ENVIRONMENT } from './common/constants/env.constants';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // The runtime comes first: running on a Node.js past its end of life is said at every start (and refused with ENFORCE_SUPPORTED_NODE=true) before
  // anything is initialised. See src/config/node-support.ts and docs/OPERATIONS.md ("Node.js").
  const runtime = judgeNodeRuntime(process.version, new Date().toISOString().slice(0, 10), process.env);
  if (runtime.message) (runtime.refuse ? logger.error : logger.warn).call(logger, runtime.message);
  if (runtime.refuse) process.exit(1);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('API_PREFIX', 'api');

  // Liveness / readiness (HealthController) live outside the API prefix and its version, so a load balancer or uptime monitor is configured once.
  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // SIGTERM / SIGINT close the application in order — readiness flips to 503 first (HealthService), then the HTTP server stops accepting, scheduled jobs
  // stop, and the database pool and Redis connection are closed (OnModuleDestroy). Without this a restart dropped in-flight requests and left sockets open.
  app.enableShutdownHooks();
  // ConfigModule has already loaded the selected env file into process.env by the time the app exists.
  configureHttpSecurity(app, process.env);
  app.use(createProxyHeaderWarning(process.env, (message) => logger.warn(message)));
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

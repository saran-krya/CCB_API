import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('API_PREFIX', 'api');

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors();
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
  const swaggerConfig = new DocumentBuilder()
    .setTitle('HVAC/BTU Metering Platform API')
    .setDescription('Enterprise backend APIs for Dubai apartment HVAC and BTU metering operations.')
    .setVersion('1.0')
    .addBearerAuth()
    // .addOAuth2({
    //   type: 'oauth2',
    //   flows: {
    //     authorizationCode: {
    //       authorizationUrl: config.get<string>('SSO_AUTHORIZATION_URL', ''),
    //       tokenUrl: config.get<string>('SSO_TOKEN_URL', ''),
    //       scopes: {},
    //     },
    //   },
    // })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(config.get<number>('PORT', 4000));
}

void bootstrap();

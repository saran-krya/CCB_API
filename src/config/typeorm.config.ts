import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { resolveDatabaseBehaviour } from './runtime-config';
import { ENV_KEY } from '../common/constants/env.constants';
import { DEFAULT_DB_PORT } from '../common/constants/database.constants';

export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    // Schema auto-sync and SQL logging are developer-machine conveniences only — see
    // resolveDatabaseBehaviour for the exact rules (and why enabling sync elsewhere is a startup error).
    const { synchronize, logging, migrationsRun } = resolveDatabaseBehaviour({
      NODE_ENV: config.get<string>('NODE_ENV'),
      DB_SYNCHRONIZE: config.get<string>('DB_SYNCHRONIZE'),
      DB_LOGGING: config.get<string>('DB_LOGGING'),
      DB_MIGRATIONS_RUN: config.get<string>('DB_MIGRATIONS_RUN'),
    });
    return {
      type: 'mysql' as const,
      host: config.get<string>('DB_HOST'),
      port: config.get<number>('DB_PORT', DEFAULT_DB_PORT),
      username: config.get<string>('DB_USERNAME'),
      password: config.get<string>(ENV_KEY.DB_PASSWORD),
      database: config.get<string>('DB_DATABASE'),
      autoLoadEntities: true,
      synchronize,
      migrations: [__dirname + '/../migrations/*{.ts,.js}'],
      migrationsRun,
      logging,
      charset: 'utf8mb4',
    };
  },
};

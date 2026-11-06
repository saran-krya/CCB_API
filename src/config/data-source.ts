import { config } from 'dotenv';
import { basename } from 'path';
import { DataSource } from 'typeorm';
import { resolveEnvFilePath } from './env-file';
import { DEFAULT_DB_PORT } from '../common/constants/database.constants';

const envFile = resolveEnvFilePath();
config({ path: envFile });

// The migration CLI changes a real schema, so it may use a different (DDL-capable) account than the
// running API, which can then be limited to data changes only (see scripts/db/provision-db-users.sql).
// DB_MIGRATION_USERNAME/DB_MIGRATION_PASSWORD fall back to the API's own DB_USERNAME/DB_PASSWORD, so
// an environment with a single account behaves exactly as before.
const username = process.env.DB_MIGRATION_USERNAME || process.env.DB_USERNAME;
const password = process.env.DB_MIGRATION_USERNAME ? process.env.DB_MIGRATION_PASSWORD : process.env.DB_PASSWORD;

// Say which database they are about to hit.
console.log(`[typeorm-cli] ${basename(envFile)} -> ${username}@${process.env.DB_HOST}/${process.env.DB_DATABASE}`);

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? DEFAULT_DB_PORT),
  username,
  password,
  database: process.env.DB_DATABASE,
  charset: 'utf8mb4',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,
});

import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * CLI-only DataSource for the TypeORM migration commands (migration:generate/run/revert). The
 * running Nest app itself uses typeorm.config.ts's async factory instead — this file exists only
 * because the TypeORM CLI needs a plain DataSource export, not a NestJS module factory. Kept in
 * sync manually: same connection env vars, same entity glob, same migrations glob.
 */
export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  charset: 'utf8mb4',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,
});

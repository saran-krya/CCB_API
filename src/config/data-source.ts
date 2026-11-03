import { config } from 'dotenv';
import { basename } from 'path';
import { DataSource } from 'typeorm';
import { resolveEnvFilePath } from './env-file';

const envFile = resolveEnvFilePath();
config({ path: envFile });
// The migration commands change a real schema, so say which database they are about to hit.
console.log(
  `[typeorm-cli] ${basename(envFile)} -> ${process.env.DB_USERNAME}@${process.env.DB_HOST}/${process.env.DB_DATABASE}`,
);

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

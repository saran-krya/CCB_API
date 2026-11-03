import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Which dotenv file this process reads, chosen by the APP_ENV variable of the process itself (shell,
 * pm2, systemd ...) — it can't live inside a dotenv file, since it decides which one gets loaded.
 *   unset / "local" -> .env      (a developer machine, same as before APP_ENV existed)
 *   "dev"           -> .env.dev  (the DEV server)
 * Shared by app.module.ts (the running API) and data-source.ts (the TypeORM migration CLI) so the two
 * can never read different files, i.e. never target different databases. A name with no matching file
 * throws rather than falling back to .env: silently reading the wrong file would run migrations
 * against the wrong database. Resolved against the working directory, like dotenv's own default.
 */
export function resolveEnvFilePath(): string {
  const name = process.env.APP_ENV?.trim().toLowerCase();
  if (!name || name === 'local') return resolve(process.cwd(), '.env');
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(
      `APP_ENV="${process.env.APP_ENV}" is not a valid environment name (letters, digits, "_" or "-", e.g. "dev").`,
    );
  }
  const file = resolve(process.cwd(), `.env.${name}`);
  if (!existsSync(file)) {
    throw new Error(`APP_ENV="${name}" selects ${file}, but that file does not exist.`);
  }
  return file;
}

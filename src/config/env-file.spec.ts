import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { resolveEnvFilePath } from './env-file';

// Which dotenv file the API and the migration CLI read is chosen by APP_ENV. Getting it wrong means
// pointing at the wrong database, so the failure modes matter as much as the happy path.
describe('resolveEnvFilePath', () => {
  const originalAppEnv = process.env.APP_ENV;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-file-'));
    jest.spyOn(process, 'cwd').mockReturnValue(dir);
    delete process.env.APP_ENV;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
  });

  it('reads .env when APP_ENV is unset, blank or "local", exactly as before APP_ENV existed', () => {
    expect(resolveEnvFilePath()).toBe(resolve(dir, '.env'));
    process.env.APP_ENV = '   ';
    expect(resolveEnvFilePath()).toBe(resolve(dir, '.env'));
    process.env.APP_ENV = 'local';
    expect(resolveEnvFilePath()).toBe(resolve(dir, '.env'));
  });

  it('reads .env.dev when APP_ENV=dev, ignoring case and surrounding spaces', () => {
    writeFileSync(join(dir, '.env.dev'), 'DB_HOST=dev-host\n');
    process.env.APP_ENV = 'dev';
    expect(resolveEnvFilePath()).toBe(resolve(dir, '.env.dev'));
    process.env.APP_ENV = ' DEV ';
    expect(resolveEnvFilePath()).toBe(resolve(dir, '.env.dev'));
  });

  it('throws instead of falling back to .env when the selected file is missing', () => {
    writeFileSync(join(dir, '.env'), 'DB_HOST=local-host\n');
    process.env.APP_ENV = 'dev';
    expect(() => resolveEnvFilePath()).toThrow(/APP_ENV="dev".*does not exist/);
  });

  it('rejects names that could point outside the project folder', () => {
    for (const bad of ['../secrets', 'dev/prod', 'dev.local', 'a b']) {
      process.env.APP_ENV = bad;
      expect(() => resolveEnvFilePath()).toThrow(/not a valid environment name/);
    }
  });
});

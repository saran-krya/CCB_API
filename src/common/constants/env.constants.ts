/** The runtime environments the app distinguishes (see resolveAppEnvironment): only `development` and `test` are relaxed, anything else is production-like. */
export const APP_ENVIRONMENT = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const;

/** Environment variable names that are read through `ConfigService` (or listed for validation) in more than one place. */
export const ENV_KEY = {
  JWT_SECRET: 'JWT_SECRET',
  JWT_EXPIRES_IN: 'JWT_EXPIRES_IN',
  REFRESH_TOKEN_EXPIRES_IN: 'REFRESH_TOKEN_EXPIRES_IN',
  REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN: 'REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN',
  DB_PASSWORD: 'DB_PASSWORD',
  DEFAULT_ADMIN_PASSWORD: 'DEFAULT_ADMIN_PASSWORD',
  SESSION_TIMEOUT_MINUTES: 'SESSION_TIMEOUT_MINUTES',
  DEFAULT_ADMIN_EMAIL: 'DEFAULT_ADMIN_EMAIL',
  /** "false" = a fresh database's first start creates no default administrator account (the first administrator is created afterwards with the
   *  server maintenance tool, `npm run maintenance:super-admin`). Unset = unchanged. */
  BOOTSTRAP_SEED_ADMIN: 'BOOTSTRAP_SEED_ADMIN',
  /** "true" = a fresh database's first start also loads the sample Community / Property / Unit data; "false" = never. Unset: loaded on a developer
   *  machine and in tests, NEVER in production (see BootstrapService.seedsDemoData). */
  BOOTSTRAP_SEED_DEMO_DATA: 'BOOTSTRAP_SEED_DEMO_DATA',
  SMTP_USER: 'SMTP_USER',
  SFTP_REMOTE_PATH: 'SFTP_REMOTE_PATH',
};

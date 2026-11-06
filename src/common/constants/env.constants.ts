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
  SMTP_USER: 'SMTP_USER',
  SFTP_REMOTE_PATH: 'SFTP_REMOTE_PATH',
};

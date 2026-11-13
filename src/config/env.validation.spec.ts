import { validateEnv } from './env.validation';

const SECRET = 'f3a9c1d27b8e4065a1b2c3d4e5f60718293a4b5c6d7e8f90';
const base = (overrides: Record<string, string | undefined> = {}) => ({ NODE_ENV: 'development', JWT_SECRET: SECRET, ...overrides });
const production = (overrides: Record<string, string | undefined> = {}) =>
  base({ NODE_ENV: 'production', DB_USERNAME: 'ccb_app', DB_PASSWORD: 'a-real-database-password-9X', DEFAULT_ADMIN_PASSWORD: 'A-real-initial-Passw0rd!', ...overrides });
const problemsOf = (env: Record<string, unknown>): string => {
  try {
    validateEnv(env);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('start-up environment validation', () => {
  it('accepts a sound development and production configuration', () => {
    expect(problemsOf(base())).toBe('');
    expect(problemsOf(production())).toBe('');
  });

  it('refuses a missing, short, placeholder or repeated-character JWT secret', () => {
    expect(problemsOf(base({ JWT_SECRET: undefined }))).toContain('JWT_SECRET is required');
    expect(problemsOf(base({ JWT_SECRET: 'short' }))).toContain('at least 32 characters');
    expect(problemsOf(base({ JWT_SECRET: '__SET_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS__' }))).toContain('not a placeholder');
    expect(problemsOf(base({ JWT_SECRET: 'a'.repeat(48) }))).toContain('repeated character');
  });

  it('refuses the root database account and schema sync in production only', () => {
    expect(problemsOf(production({ DB_USERNAME: 'root' }))).toContain('DB_USERNAME must be a least-privilege');
    expect(problemsOf(production({ DB_SYNCHRONIZE: 'true' }))).toContain('DB_SYNCHRONIZE');
    expect(problemsOf(base({ DB_USERNAME: 'root', DB_SYNCHRONIZE: 'true' }))).toBe('');
  });

  it('refuses a wildcard CORS origin everywhere', () => {
    expect(problemsOf(base({ CORS_ORIGINS: '*' }))).toContain('CORS_ORIGINS');
    expect(problemsOf(production({ CORS_ORIGINS: 'https://app.customer.example, *' }))).toContain('CORS_ORIGINS');
    expect(problemsOf(production({ CORS_ORIGINS: 'https://app.customer.example' }))).toBe('');
  });

  it('refuses TRUST_PROXY=true (trust everybody) and accepts a hop count or an address list', () => {
    expect(problemsOf(production({ TRUST_PROXY: 'true' }))).toContain('TRUST_PROXY');
    expect(problemsOf(base({ TRUST_PROXY: 'yes' }))).toContain('TRUST_PROXY');
    expect(problemsOf(production({ TRUST_PROXY: '1' }))).toBe('');
    expect(problemsOf(production({ TRUST_PROXY: 'loopback, 10.0.0.0/8' }))).toBe('');
  });

  it('reports every problem at once, by key name only — never a value', () => {
    const message = problemsOf(production({ JWT_SECRET: 'short', DB_USERNAME: 'root', TRUST_PROXY: 'true', DB_PASSWORD: 'a-real-database-password-9X' }));
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('DB_USERNAME');
    expect(message).toContain('TRUST_PROXY');
    expect(message).not.toContain('a-real-database-password-9X');
  });

  it('checks the remember-me lifetime format', () => {
    expect(problemsOf(base({ REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN: '30d' }))).toBe('');
    expect(problemsOf(base({ REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN: 'a month' }))).toContain('REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN');
  });
});

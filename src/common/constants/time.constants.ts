export const SECONDS_PER_MINUTE = 60;

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Milliseconds per unit of the compact duration format used by JWT_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN and the
 *  activation-token expiry ("30s", "15m", "1h", "7d"). */
export const DURATION_UNIT_MS: Record<string, number> = {
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
};

/** Length of the `YYYY-MM-DD` prefix of `Date#toISOString()`. */
export const ISO_DATE_LENGTH = 10;

/** Appended to a `YYYY-MM-DD` string to parse it as midnight in the server's local zone / in UTC. */
export const LOCAL_MIDNIGHT_SUFFIX = 'T00:00:00';
export const UTC_MIDNIGHT_SUFFIX = 'T00:00:00Z';

/** Widest date range (in days) a trend / report endpoint accepts. It bounds the size of the response and the
 *  day-by-day loop `getDailyReadingsTrend` runs, so one request cannot ask for an unbounded span. */
export const TREND_MAX_DAYS = 90;

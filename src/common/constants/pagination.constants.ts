// Plain `const`s on purpose (not an `as const` object): a class property initialised from one of these
// (`limit = DEFAULT_LIMIT`) must still be inferred as `number`, exactly as `limit = 20` was.

/** First page of a list query, and the lowest page number it accepts. */
export const DEFAULT_PAGE = 1;
export const MIN_PAGE = 1;

/** Lowest and highest page size any list query accepts. */
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;

/** Page size of the standard list queries (BasePaginationDto, Roles, billing cycles, SFTP files). */
export const DEFAULT_LIMIT = 20;

/** Page size of the compact list queries: Users and the Policies screens. */
export const SHORT_LIST_DEFAULT_LIMIT = 10;

/** The two sort directions every list query accepts: DTO validation, Swagger and TypeORM ordering all use these. */
export const SORT_ORDER = {
  ASC: 'ASC',
  DESC: 'DESC',
} as const;

export type SortOrder = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];

/** The allowed values as a plain array — for `@IsIn(...)` and Swagger's `enum`. */
export const SORT_ORDER_VALUES: SortOrder[] = [SORT_ORDER.ASC, SORT_ORDER.DESC];

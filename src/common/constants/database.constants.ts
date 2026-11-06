/** MySQL / MariaDB driver error codes the application reacts to (`QueryFailedError.driverError.code`). */
export const MYSQL_ERROR_CODE = {
  DUP_ENTRY: 'ER_DUP_ENTRY',
  NO_REFERENCED_ROW: 'ER_NO_REFERENCED_ROW',
  NO_REFERENCED_ROW_2: 'ER_NO_REFERENCED_ROW_2',
  ROW_IS_REFERENCED: 'ER_ROW_IS_REFERENCED',
  ROW_IS_REFERENCED_2: 'ER_ROW_IS_REFERENCED_2',
  DATA_TOO_LONG: 'ER_DATA_TOO_LONG',
  BAD_NULL_ERROR: 'ER_BAD_NULL_ERROR',
  NO_DEFAULT_FOR_FIELD: 'ER_NO_DEFAULT_FOR_FIELD',
  TRUNCATED_WRONG_VALUE: 'ER_TRUNCATED_WRONG_VALUE',
  TRUNCATED_WRONG_VALUE_FOR_FIELD: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
  WARN_DATA_OUT_OF_RANGE: 'ER_WARN_DATA_OUT_OF_RANGE',
  DATA_OUT_OF_RANGE: 'ER_DATA_OUT_OF_RANGE',
  INVALID_JSON_TEXT: 'ER_INVALID_JSON_TEXT',
  INVALID_JSON_TEXT_IN_PARAM: 'ER_INVALID_JSON_TEXT_IN_PARAM',
  LOCK_DEADLOCK: 'ER_LOCK_DEADLOCK',
  LOCK_WAIT_TIMEOUT: 'ER_LOCK_WAIT_TIMEOUT',
  /** The table does not exist — at startup, the schema has not been created (migrations did not run). */
  NO_SUCH_TABLE: 'ER_NO_SUCH_TABLE',
};

/** TypeORM row-lock mode taken by the services' read-then-write transactions. `as const`: TypeORM's `setLock` and
 *  `lock.mode` only accept the literal. */
export const LOCK_MODE = {
  PESSIMISTIC_WRITE: 'pessimistic_write',
} as const;

/** MySQL's default port, used when DB_PORT is not set. */
export const DEFAULT_DB_PORT = 3306;

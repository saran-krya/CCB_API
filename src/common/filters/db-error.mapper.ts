import { HttpStatus } from '@nestjs/common';
import { MYSQL_ERROR_CODE } from '../constants/database.constants';
import { ERROR_MESSAGES } from '../constants/error-messages.constants';

export interface SafeError {
  status: number;
  message: string;
}

/** The driver-level error codes a MySQL/MariaDB failure can carry. TypeORM wraps the driver error in a
 *  QueryFailedError (`driverError`), but the same fields also appear directly on a raw driver error. */
interface DriverErrorLike {
  code?: unknown;
  errno?: unknown;
  sqlState?: unknown;
  sqlMessage?: unknown;
}

const asDriverError = (exception: unknown): DriverErrorLike | null => {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidate = exception as { driverError?: unknown } & DriverErrorLike;
  const source = typeof candidate.driverError === 'object' && candidate.driverError !== null
    ? (candidate.driverError as DriverErrorLike)
    : candidate;
  return typeof source.code === 'string' && /^(ER_|ECONN|PROTOCOL_)/.test(source.code) ? source : null;
};

/**
 * Turns a database failure into a response that is safe to send to a client: a generic message and the
 * right status, NEVER the driver's text (which carries table/column/index names, SQL fragments and the
 * offending value — e.g. "Duplicate entry 'jane@x.com' for key 'users.IDX_97672ac8...'").
 *
 * Returns null when `exception` is not a database error. Anything database-related that has no
 * dedicated mapping is a 500 with a fixed message.
 */
export function mapDatabaseError(exception: unknown): SafeError | null {
  const driver = asDriverError(exception);
  if (!driver) return null;

  switch (driver.code) {
    case MYSQL_ERROR_CODE.DUP_ENTRY:
      return { status: HttpStatus.CONFLICT, message: 'A record with the same unique value already exists.' };
    case MYSQL_ERROR_CODE.NO_REFERENCED_ROW:
    case MYSQL_ERROR_CODE.NO_REFERENCED_ROW_2:
      return { status: HttpStatus.BAD_REQUEST, message: 'A referenced record does not exist.' };
    case MYSQL_ERROR_CODE.ROW_IS_REFERENCED:
    case MYSQL_ERROR_CODE.ROW_IS_REFERENCED_2:
      return { status: HttpStatus.CONFLICT, message: 'This record is still in use and cannot be changed or deleted.' };
    case MYSQL_ERROR_CODE.DATA_TOO_LONG:
      return { status: HttpStatus.BAD_REQUEST, message: 'A submitted value is too long.' };
    case MYSQL_ERROR_CODE.BAD_NULL_ERROR:
    case MYSQL_ERROR_CODE.NO_DEFAULT_FOR_FIELD:
      return { status: HttpStatus.BAD_REQUEST, message: 'A required value is missing.' };
    case MYSQL_ERROR_CODE.TRUNCATED_WRONG_VALUE:
    case MYSQL_ERROR_CODE.TRUNCATED_WRONG_VALUE_FOR_FIELD:
    case MYSQL_ERROR_CODE.WARN_DATA_OUT_OF_RANGE:
    case MYSQL_ERROR_CODE.DATA_OUT_OF_RANGE:
    case MYSQL_ERROR_CODE.INVALID_JSON_TEXT:
    case MYSQL_ERROR_CODE.INVALID_JSON_TEXT_IN_PARAM:
      return { status: HttpStatus.BAD_REQUEST, message: 'A submitted value is invalid.' };
    case MYSQL_ERROR_CODE.LOCK_DEADLOCK:
    case MYSQL_ERROR_CODE.LOCK_WAIT_TIMEOUT:
      return { status: HttpStatus.CONFLICT, message: 'The request conflicted with another change. Please try again.' };
    default:
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR };
  }
}

/** True for the 4xx errors raised by Express middleware (body-parser: malformed JSON, payload too large)
 *  — they carry an http-errors style numeric `status`/`statusCode` and a flag saying the message is safe
 *  to show. Their message is replaced by a fixed one anyway. */
export function mapHttpMiddlewareError(exception: unknown): SafeError | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, statusCode, type } = exception as { status?: unknown; statusCode?: unknown; type?: unknown };
  const code = typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : undefined;
  if (code === undefined || code < 400 || code > 499) return null;
  if (type === 'entity.too.large' || code === HttpStatus.PAYLOAD_TOO_LARGE) return { status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'Request entity too large.' };
  if (type === 'entity.parse.failed' || code === HttpStatus.BAD_REQUEST) return { status: HttpStatus.BAD_REQUEST, message: ERROR_MESSAGES.REQUEST_BODY_UNPARSEABLE };
  return { status: code, message: 'The request could not be processed.' };
}

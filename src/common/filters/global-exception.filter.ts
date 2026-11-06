import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MulterError } from 'multer';
import { mapDatabaseError, mapHttpMiddlewareError } from './db-error.mapper';
import { ERROR_MESSAGES } from '../constants/error-messages.constants';

/** The wording of a JSON.parse failure ("Unexpected token 'h', \"hunter2-secret=1&x=2\" is not valid JSON"): it quotes
 *  a fragment of what the client sent, so it is never passed on. */
const JSON_PARSE_MESSAGE = /is not valid JSON|in JSON at position|Unexpected end of JSON input|Expected .+ in JSON|Unexpected token/i;

/** The router's own 404 wording, "Cannot GET /path?query": the query string can carry tokens or search text. */
const UNMATCHED_ROUTE_MESSAGE = /^Cannot [A-Z]+ \S/;

const MULTER_ERROR_STATUS: Record<string, number> = {
  LIMIT_FILE_SIZE: HttpStatus.PAYLOAD_TOO_LARGE,
  LIMIT_FILE_COUNT: HttpStatus.BAD_REQUEST,
  LIMIT_UNEXPECTED_FILE: HttpStatus.BAD_REQUEST,
};

/**
 * The one place every error leaves the API. A deliberate HttpException is passed through exactly as
 * thrown (its status and body are the route author's own, already client-safe, wording). Anything else
 * is an unexpected failure and is NEVER echoed: a database error becomes a generic 400/409/500 (see
 * mapDatabaseError), a body-parser error becomes a fixed 400/413, and every other thrown value is a
 * fixed 500 "Internal server error". The real error — message, stack and the request it came from — is
 * written to the server log only, for 5xx responses.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(`${request.method} ${this.pathOf(request)} -> ${status}: ${detail}`);
    }

    // A rate-limit or lockout response says when to retry, in the standard header as well as the body.
    const retryAfter = body.retryAfterSeconds;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
      response.setHeader('Retry-After', String(Math.ceil(retryAfter)));
    }

    response.status(status).json({
      ...body,
      statusCode: status,
      timestamp: new Date().toISOString(),
      // Without the query string: it can carry tokens or search text that must not be reflected back.
      path: this.pathOf(request),
    });
  }

  private resolve(exception: unknown): { status: number; body: Record<string, unknown> } {
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      const status = exception.getStatus();
      const body =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? (exceptionResponse as Record<string, unknown>)
          : { message: exception.message };
      return { status, body: this.withoutReflectedInput(status, body) };
    }
    if (exception instanceof MulterError) {
      return {
        status: MULTER_ERROR_STATUS[exception.code] ?? HttpStatus.BAD_REQUEST,
        body: { message: exception.message },
      };
    }
    const safe = mapDatabaseError(exception) ?? mapHttpMiddlewareError(exception);
    if (safe) return { status: safe.status, body: { message: safe.message } };
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR } };
  }

  /** Nest itself turns a body-parser SyntaxError into BadRequestException(<the parser's message>) and an
   *  unmatched route into NotFoundException("Cannot GET <url with query>") BEFORE this filter runs, so both
   *  arrive here as ordinary HttpExceptions whose text echoes client input. Those two are rewritten; every
   *  other HttpException keeps the wording its author wrote. */
  private withoutReflectedInput(status: number, body: Record<string, unknown>): Record<string, unknown> {
    const message = body.message;
    if (typeof message !== 'string') return body;
    if (status === HttpStatus.BAD_REQUEST && JSON_PARSE_MESSAGE.test(message)) {
      return { ...body, message: ERROR_MESSAGES.REQUEST_BODY_UNPARSEABLE };
    }
    if (status === HttpStatus.NOT_FOUND && UNMATCHED_ROUTE_MESSAGE.test(message)) {
      return { ...body, message: message.split('?')[0] };
    }
    return body;
  }

  private pathOf(request: Request): string {
    return (request.originalUrl ?? request.url ?? '').split('?')[0];
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MulterError } from 'multer';

// Multer throws its own error class (not a NestJS HttpException) when an
// upload violates the interceptor's configured limits (fileSize, etc.) —
// without this mapping it falls through to the generic 500 branch below,
// which is the wrong status code for what is really a client-side "your
// upload didn't meet our limits" case.
const MULTER_ERROR_STATUS: Record<string, number> = {
  LIMIT_FILE_SIZE: HttpStatus.PAYLOAD_TOO_LARGE,
  LIMIT_FILE_COUNT: HttpStatus.BAD_REQUEST,
  LIMIT_UNEXPECTED_FILE: HttpStatus.BAD_REQUEST,
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = this.resolveStatus(exception);
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    // Passes through every property of a structured exception body (not
    // just `message`) — e.g. `throw new BadRequestException({ message,
    // issues })` reaches the client with `issues` intact, instead of being
    // silently dropped down to a single string. statusCode/timestamp/path
    // are asserted after the spread so they're never shadowed by whatever
    // the exception body happens to contain.
    const exceptionBody =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)
        : { message: exception instanceof Error ? exception.message : 'Internal server error' };

    response.status(status).json({
      ...exceptionBody,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception instanceof MulterError) return MULTER_ERROR_STATUS[exception.code] ?? HttpStatus.BAD_REQUEST;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

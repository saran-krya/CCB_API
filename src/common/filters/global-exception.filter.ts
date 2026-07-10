import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

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
}

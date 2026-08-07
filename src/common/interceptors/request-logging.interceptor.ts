import {
    CallHandler,
    ExecutionContext,
    Injectable,
    Logger,
    NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger(RequestLoggingInterceptor.name);

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const httpContext = context.switchToHttp();
        const req = httpContext.getRequest<Request & { requestId?: string }>();
        const res = httpContext.getResponse<Response>();
        const startTime = Date.now();

        return next.handle().pipe(
            tap({
                next: () => {
                    const duration = Date.now() - startTime;
                    this.logger.log(
                        `${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${duration}ms - request_id=${req.requestId || 'n/a'}`,
                    );
                },
                error: () => {
                    const duration = Date.now() - startTime;
                    this.logger.error(
                        `${req.method} ${req.originalUrl || req.url} ${res.statusCode || 500} - ${duration}ms - request_id=${req.requestId || 'n/a'}`,
                    );
                },
            }),
        );
    }
}

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const httpContext = context.switchToHttp();
        const req = httpContext.getRequest<Request & { requestId?: string }>();
        const res = httpContext.getResponse<Response>();

        return next.handle().pipe(
            map((data) => {
                if (res.headersSent) {
                    return data;
                }

                if (
                    data &&
                    typeof data === 'object' &&
                    'success' in data &&
                    'response_code' in data &&
                    'response_description' in data
                ) {
                    return {
                        ...data,
                        request_id: data.request_id ?? req.requestId ?? null,
                        path: data.path ?? (req.originalUrl || req.url),
                        timestamp: data.timestamp ?? new Date().toISOString(),
                    };
                }

                return {
                    success: true,
                    response_code: '00',
                    response_description: 'Success',
                    data: data ?? null,
                    request_id: req.requestId ?? null,
                    path: req.originalUrl || req.url,
                    timestamp: new Date().toISOString(),
                };
            }),
        );
    }
}

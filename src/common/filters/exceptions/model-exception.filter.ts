import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ModelNotFound } from '../../exceptions/model-not-found.exception';

@Catch(ModelNotFound)
export class ModelExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(ModelExceptionFilter.name);

    catch(exception: ModelNotFound, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request & { requestId?: string }>();
        const status = exception.getStatus();

        response.status(status).json({
            success: false,
            response_code: '004',
            response_description: exception.message,
            message: exception.message,
            request_id: request?.requestId || null,
            path: request?.url || null,
            timestamp: new Date().toISOString(),
        });

        this.logger.error(
            `An Error Occured in ${request.url} - request_id=${request?.requestId || 'n/a'}`,
            exception.stack,
        );
    }
}

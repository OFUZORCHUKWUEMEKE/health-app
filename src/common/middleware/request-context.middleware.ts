import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export type RequestWithContext = Request & {
    requestId?: string;
};

export function requestContextMiddleware(
    req: RequestWithContext,
    res: Response,
    next: NextFunction,
) {
    const incomingRequestId = req.headers['x-request-id'];
    const requestId =
        typeof incomingRequestId === 'string' && incomingRequestId.trim().length > 0
            ? incomingRequestId
            : randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    next();
}

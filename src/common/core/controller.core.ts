import { Controller } from '@nestjs/common';
import { Request } from 'express';
import { Response } from 'express';

@Controller()
export class CoreController {
    async responseSuccess(
        res: Response,
        res_code: string,
        res_des: string,
        data: any,
        code: number,
    ) {
        const request = res.req as Request & { requestId?: string };
        res.status(code).json({
            success: true,
            response_code: `${res_code}`,
            response_description: `${res_des}`,
            data,
            request_id: request?.requestId || null,
            path: request?.url || null,
            timestamp: new Date().toISOString(),
        });
    }
}

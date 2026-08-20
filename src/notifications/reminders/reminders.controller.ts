import {
    Controller,
    ForbiddenException,
    Headers,
    HttpStatus,
    Post,
    Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';
import { CoreController } from 'src/common/core/controller.core';
import { AppointmentReminderService } from './appointment-reminder.service';

/**
 * Manual trigger for the reminder sweep.
 *
 * Two reasons this exists rather than relying on @Cron alone:
 *
 *  1. It is how the reminder path is tested without waiting an hour — book something 50
 *     minutes out, call this, assert the feeds. Calling it twice also proves idempotency:
 *     the second run reports 0 created.
 *  2. It is the escape hatch if in-process scheduling is ever swapped for external cron or
 *     the service scales past one instance. The cron method is a thin wrapper over the same
 *     dispatchDueReminders(), so nothing else would need to change.
 *
 * Guarded by a shared secret rather than a role: the caller is a machine, not a user.
 * Follows the existing ALLOW_ADMIN_BOOTSTRAP / ADMIN_BOOTSTRAP_KEY pattern in auth.service.
 * Excluded from Swagger — it is operational, not part of the public API.
 *
 * Deliberately NOT wired into /api/v1/health: Render pings that on its own cadence, and a
 * health check that performs writes is a bad idea.
 */
@Controller('internal/reminders')
export class RemindersController extends CoreController {
    constructor(
        private readonly reminderService: AppointmentReminderService,
        private readonly configService: ConfigService,
    ) {
        super();
    }

    @Post('dispatch')
    @ApiExcludeEndpoint()
    async dispatch(
        @Headers('x-reminder-key') providedKey: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const expectedKey = this.configService.get<string>('REMINDER_DISPATCH_KEY');

        // Absent config means disabled, not open. An unset secret must never mean "allow".
        if (!expectedKey) {
            throw new ForbiddenException('REMINDER_DISPATCH_KEY is not configured');
        }

        if (!providedKey || providedKey !== expectedKey) {
            throw new ForbiddenException('Invalid reminder dispatch key');
        }

        const result = await this.reminderService.dispatchDueReminders();
        return this.responseSuccess(res, '00', 'Success', result, HttpStatus.OK);
    }
}

import {
    Controller,
    Delete,
    Get,
    HttpStatus,
    Param,
    Patch,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CoreController } from 'src/common/core/controller.core';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { NotificationRecipientType, Role } from 'src/common/enums';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { ListNotificationsQueryDto } from '../dto/list-notifications.dto';
import { NotificationsService } from '../notifications.service';

/**
 * Routes are `me`-scoped, and that is load-bearing rather than cosmetic:
 * `src/users/users.controller.ts` declares `@Get(':id')` under `@Controller('patients')`
 * with `@Roles(Role.ADMIN)`, and UsersModule is registered first. `GET /patients/notifications`
 * would therefore match `:id` and fail with "Access denied. Required roles: admin" — a
 * maximally confusing 401 for a patient reading their own feed.
 *
 * Separate patient and doctor controllers (mirroring consultations/controllers/) rather than
 * one with role branching: `recipient_type` is then a compile-time constant per class, so no
 * code path exists that could serve one role the other's feed.
 */
@ApiTags('Patient Notifications')
@ApiBearerAuth()
@Controller('patients/me/notifications')
@UseGuards(RolesGuard)
@Roles(Role.PATIENT)
export class PatientNotificationsController extends CoreController {
    private readonly recipientType = NotificationRecipientType.PATIENT;

    constructor(private readonly notificationsService: NotificationsService) {
        super();
    }

    // NOTE: `unread-count` and `read-all` MUST be declared before any `:id` route, or Nest
    // resolves them as `:id`.

    @Get()
    @ApiOperation({ summary: 'List my notifications, newest first' })
    @ApiResponse({
        status: 200,
        description:
            'Paginated feed. `unread_count` is bundled so a bell badge needs no second call.',
    })
    async list(
        @CurrentUser() user: any,
        @Query() query: ListNotificationsQueryDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.notificationsService.list(
            { recipient_id: user._id, recipient_type: this.recipientType },
            query,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('unread-count')
    @ApiOperation({ summary: 'Count my unread notifications' })
    @ApiResponse({ status: 200, description: 'Returns `{ unread: number }`.' })
    async unreadCount(
        @CurrentUser() user: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const unread = await this.notificationsService.unreadCount({
            recipient_id: user._id,
            recipient_type: this.recipientType,
        });
        return this.responseSuccess(res, '00', 'Success', { unread }, HttpStatus.OK);
    }

    @Patch('read-all')
    @ApiOperation({ summary: 'Mark every unread notification as read' })
    @ApiResponse({ status: 200, description: 'Returns `{ modified: number }`.' })
    async markAllRead(
        @CurrentUser() user: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const modified = await this.notificationsService.markAllRead({
            recipient_id: user._id,
            recipient_type: this.recipientType,
        });
        return this.responseSuccess(res, '00', 'Success', { modified }, HttpStatus.OK);
    }

    @Patch(':id/read')
    @ApiOperation({ summary: 'Mark one notification as read' })
    @ApiParam({ name: 'id', description: 'Notification id' })
    @ApiResponse({
        status: 404,
        description: "Not found, or not yours — the two are deliberately indistinguishable.",
    })
    async markRead(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.notificationsService.markRead(
            { recipient_id: user._id, recipient_type: this.recipientType },
            id,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete one of my notifications' })
    @ApiParam({ name: 'id', description: 'Notification id' })
    @ApiResponse({ status: 404, description: 'Not found, or not yours.' })
    async remove(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        await this.notificationsService.remove(
            { recipient_id: user._id, recipient_type: this.recipientType },
            id,
        );
        return this.responseSuccess(res, '00', 'Success', { deleted: true }, HttpStatus.OK);
    }
}

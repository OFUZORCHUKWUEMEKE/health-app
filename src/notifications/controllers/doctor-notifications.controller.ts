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
import { Roles } from 'src/common/decorators/roles.decorator';
import { NotificationRecipientType, Role } from 'src/common/enums';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { ListNotificationsQueryDto } from '../dto/list-notifications.dto';
import { NotificationsService } from '../notifications.service';

/** Doctor-side mirror of PatientNotificationsController — see there for why these are two
 *  classes and why the routes are `me`-scoped. */
@ApiTags('Doctor Notifications')
@ApiBearerAuth()
@Controller('doctors/me/notifications')
@UseGuards(RolesGuard)
@Roles(Role.DOCTOR)
export class DoctorNotificationsController extends CoreController {
    private readonly recipientType = NotificationRecipientType.DOCTOR;

    constructor(private readonly notificationsService: NotificationsService) {
        super();
    }

    // `unread-count` and `read-all` before `:id` — otherwise Nest matches them as an id.

    @Get()
    @ApiOperation({ summary: 'List my notifications, newest first' })
    @ApiResponse({
        status: 200,
        description:
            'Paginated feed. `unread_count` is bundled so a bell badge needs no second call.',
    })
    async list(
        @CurrentUser() doctor: any,
        @Query() query: ListNotificationsQueryDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.notificationsService.list(
            { recipient_id: doctor._id, recipient_type: this.recipientType },
            query,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('unread-count')
    @ApiOperation({ summary: 'Count my unread notifications' })
    @ApiResponse({ status: 200, description: 'Returns `{ unread: number }`.' })
    async unreadCount(
        @CurrentUser() doctor: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const unread = await this.notificationsService.unreadCount({
            recipient_id: doctor._id,
            recipient_type: this.recipientType,
        });
        return this.responseSuccess(res, '00', 'Success', { unread }, HttpStatus.OK);
    }

    @Patch('read-all')
    @ApiOperation({ summary: 'Mark every unread notification as read' })
    @ApiResponse({ status: 200, description: 'Returns `{ modified: number }`.' })
    async markAllRead(
        @CurrentUser() doctor: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const modified = await this.notificationsService.markAllRead({
            recipient_id: doctor._id,
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
        @CurrentUser() doctor: any,
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.notificationsService.markRead(
            { recipient_id: doctor._id, recipient_type: this.recipientType },
            id,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete one of my notifications' })
    @ApiParam({ name: 'id', description: 'Notification id' })
    @ApiResponse({ status: 404, description: 'Not found, or not yours.' })
    async remove(
        @CurrentUser() doctor: any,
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        await this.notificationsService.remove(
            { recipient_id: doctor._id, recipient_type: this.recipientType },
            id,
        );
        return this.responseSuccess(res, '00', 'Success', { deleted: true }, HttpStatus.OK);
    }
}

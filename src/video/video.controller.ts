import {
    Controller,
    Get,
    Patch,
    Param,
    Req,
    Res,
    HttpStatus,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { Response, Request } from 'express';
import { VideoService } from './video.service';
import { DoctorGuard } from 'src/auth/guard/doctor.guard';
import { PatientGuard } from 'src/auth/guard/patient.guard';
import { CoreController } from 'src/common/core/controller.core';

const VIDEO_TOKEN_RESPONSE_EXAMPLE = {
    success: true,
    response_code: '00',
    response_description: 'Success',
    data: {
        appointmentId: '69d2f48d1017a08a518f2f97',
        consultationId: '64f3abc000aaa111',
        role: 'doctor',
        roomUrl: 'https://your-domain.daily.co/consultation-69d2f48d1017a08a518f2f97',
        token: 'eyJhbGciOiJIUzI1NiJ9...',
        expiresAt: '2026-04-10T10:30:00.000Z',
    },
};

const SESSION_RESPONSE_EXAMPLE = (message: string) => ({
    success: true,
    response_code: '00',
    response_description: 'Success',
    data: { message },
});

@ApiTags('Video')
@Controller()
export class VideoController extends CoreController {
    constructor(private readonly videoService: VideoService) {
        super();
    }

    @UseGuards(DoctorGuard)
    @Get('doctors/me/appointments/:id/video-token')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get doctor video token',
        description:
            'Creates a Daily.co video room (on first call) and returns a token for the doctor to join. ' +
            'The doctor must call this before the patient can join.',
    })
    @ApiParam({ name: 'id', description: 'Appointment ID', example: '69d2f48d1017a08a518f2f97' })
    @ApiResponse({
        status: 200,
        description: 'Video token generated successfully',
        schema: {
            example: {
                ...VIDEO_TOKEN_RESPONSE_EXAMPLE,
                data: { ...VIDEO_TOKEN_RESPONSE_EXAMPLE.data, role: 'doctor' },
            },
        },
    })
    @ApiResponse({ status: 400, description: 'Appointment not found or not confirmed' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    @ApiResponse({ status: 403, description: 'Forbidden — appointment does not belong to this doctor' })
    async getDoctorToken(
        @Param('id') id: string,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const doctor = (req as any)['doctor'];
        const data = await this.videoService.getDoctorVideoToken(id, doctor);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @UseGuards(PatientGuard)
    @Get('patients/me/appointments/:id/video-token')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get patient video token',
        description:
            'Returns a token for the patient to join an existing video room. ' +
            'The doctor must have already called their token endpoint first to create the room.',
    })
    @ApiParam({ name: 'id', description: 'Appointment ID', example: '69d2f48d1017a08a518f2f97' })
    @ApiResponse({
        status: 200,
        description: 'Video token generated successfully',
        schema: {
            example: {
                ...VIDEO_TOKEN_RESPONSE_EXAMPLE,
                data: { ...VIDEO_TOKEN_RESPONSE_EXAMPLE.data, role: 'patient' },
            },
        },
    })
    @ApiResponse({ status: 400, description: 'Appointment not found, not confirmed, or doctor has not opened the session yet' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    @ApiResponse({ status: 403, description: 'Forbidden — appointment does not belong to this patient' })
    async getPatientToken(
        @Param('id') id: string,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const patient = (req as any)['patient'];
        const data = await this.videoService.getPatientVideoToken(id, patient);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @UseGuards(DoctorGuard)
    @Patch('doctors/me/appointments/:id/video/start')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Mark video session as started',
        description:
            'Call this once the doctor has successfully joined the Daily.co room (inside the joined-meeting event). ' +
            'Updates the linked consultation status to ACTIVE.',
    })
    @ApiParam({ name: 'id', description: 'Appointment ID', example: '69d2f48d1017a08a518f2f97' })
    @ApiResponse({
        status: 200,
        description: 'Session marked as active',
        schema: { example: SESSION_RESPONSE_EXAMPLE('Session marked as active') },
    })
    @ApiResponse({ status: 400, description: 'Appointment not found' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    @ApiResponse({ status: 403, description: 'Forbidden — appointment does not belong to this doctor' })
    async startSession(
        @Param('id') id: string,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const doctor = (req as any)['doctor'];
        await this.videoService.markSessionStarted(id, doctor._id);
        return this.responseSuccess(res, '00', 'Success', { message: 'Session marked as active' }, HttpStatus.OK);
    }

    @UseGuards(DoctorGuard)
    @Patch('doctors/me/appointments/:id/video/end')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Mark video session as ended',
        description:
            'Call this when the doctor leaves the call (inside the left-meeting event). ' +
            'This does NOT complete the consultation — the doctor must explicitly ' +
            'call PATCH /doctors/consultations/:consultation_id/complete for that.',
    })
    @ApiParam({ name: 'id', description: 'Appointment ID', example: '69d2f48d1017a08a518f2f97' })
    @ApiResponse({
        status: 200,
        description: 'Session end acknowledged (consultation remains ACTIVE until doctor completes it)',
        schema: { example: SESSION_RESPONSE_EXAMPLE('Session end acknowledged') },
    })
    @ApiResponse({ status: 400, description: 'Appointment not found' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    @ApiResponse({ status: 403, description: 'Forbidden — appointment does not belong to this doctor' })
    async endSession(
        @Param('id') id: string,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const doctor = (req as any)['doctor'];
        await this.videoService.markSessionEnded(id, doctor._id);
        return this.responseSuccess(res, '00', 'Success', { message: 'Session end acknowledged' }, HttpStatus.OK);
    }
}

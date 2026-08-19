import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    Res,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import {
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiExcludeEndpoint,
    ApiOperation,
    ApiQuery,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CoreController } from 'src/common/core/controller.core';
import { DoctorsService } from './doctors.service';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles, CurrentUser } from 'src/common/decorators';
import { Role } from 'src/common/enums';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { UpdateDoctorTimezoneDto } from './dto/update-timezone.dto';
import { UpdateProfilePictureDto } from 'src/common/core/dto/update-profile-picture.dto';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { UsersService } from 'src/users/users.service';

@ApiTags('Doctors')
@Controller('doctors')
export class DoctorsController extends CoreController {
    constructor(
        private readonly doctorService: DoctorsService,
        private readonly cloudinaryService: CloudinaryService,
        private readonly usersService: UsersService,
    ) {
        super();
    }

    @Get('me')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    async getMyProfile(
        @CurrentUser() doctor: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.doctorService.getDoctorSummary(doctor._id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('me/profile')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    async getMyFullProfile(
        @CurrentUser() doctor: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.doctorService.getDoctor(doctor._id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('me/metrics')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get pending metrics for logged-in doctor',
        description:
            'Returns pending counts: consultations not yet completed, consultations with medications not yet sent to the patient, consultations with investigations not yet sent, and upcoming appointments yet to be attended.',
    })
    @ApiResponse({
        status: 200,
        description: 'Doctor pending metrics fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    consultations: 5,
                    medications: 3,
                    investigations: 2,
                    appointments: 4,
                },
            },
        },
    })
    async getMyMetrics(
        @CurrentUser() doctor: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.doctorService.getDoctorMetrics(doctor._id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Edit logged-in doctor profile' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                phone_number: { type: 'string' },
                specializations: { type: 'array', items: { type: 'string' } },
                license_no: { type: 'string' },
                file: { type: 'string', format: 'binary' },
                image: { type: 'string', format: 'binary' },
                profile_picture: { type: 'string', format: 'binary' },
            },
        },
    })
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'file', maxCount: 1 },
                { name: 'image', maxCount: 1 },
                { name: 'profile_picture', maxCount: 1 },
            ],
            {
                limits: { fileSize: 5 * 1024 * 1024 },
            },
        ),
    )
    async updateMyProfile(
        @CurrentUser() doctor: any,
        @Body() payload: UpdateDoctorProfileDto,
        @UploadedFiles() files: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const file =
            files?.file?.[0] ||
            files?.image?.[0] ||
            files?.profile_picture?.[0];

        if (file) {
            payload.profile_picture_url = await this.cloudinaryService.uploadProfileImage(
                file,
                'doctors',
                doctor._id,
            );
        }

        const data = await this.doctorService.updateProfile(doctor._id, payload);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me/profile')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Edit logged-in doctor profile (alias route)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                phone_number: { type: 'string' },
                specializations: { type: 'array', items: { type: 'string' } },
                license_no: { type: 'string' },
                file: { type: 'string', format: 'binary' },
                image: { type: 'string', format: 'binary' },
                profile_picture: { type: 'string', format: 'binary' },
            },
        },
    })
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'file', maxCount: 1 },
                { name: 'image', maxCount: 1 },
                { name: 'profile_picture', maxCount: 1 },
            ],
            {
                limits: { fileSize: 5 * 1024 * 1024 },
            },
        ),
    )
    async updateMyFullProfile(
        @CurrentUser() doctor: any,
        @Body() payload: UpdateDoctorProfileDto,
        @UploadedFiles() files: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const file =
            files?.file?.[0] ||
            files?.image?.[0] ||
            files?.profile_picture?.[0];

        if (file) {
            payload.profile_picture_url = await this.cloudinaryService.uploadProfileImage(
                file,
                'doctors',
                doctor._id,
            );
        }

        const data = await this.doctorService.updateProfile(doctor._id, payload);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me/profile-picture')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    async updateMyProfilePicture(
        @CurrentUser() doctor: any,
        @Body() payload: UpdateProfilePictureDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.doctorService.updateProfilePicture(
            doctor._id,
            payload.profile_picture_url,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me/timezone')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Set timezone for logged-in doctor' })
    @ApiBody({ type: UpdateDoctorTimezoneDto })
    @ApiResponse({ status: 200, description: 'Timezone updated successfully' })
    async updateMyTimezone(
        @CurrentUser() doctor: any,
        @Body() payload: UpdateDoctorTimezoneDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.doctorService.updateTimezone(doctor._id, payload.timezone);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('me/profile-picture/upload')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Upload doctor profile picture to Cloudinary' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                },
                image: {
                    type: 'string',
                    format: 'binary',
                },
                profile_picture: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
    })
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'file', maxCount: 1 },
                { name: 'image', maxCount: 1 },
                { name: 'profile_picture', maxCount: 1 },
            ],
            {
                limits: { fileSize: 5 * 1024 * 1024 },
            },
        ),
    )
    async uploadMyProfilePicture(
        @CurrentUser() doctor: any,
        @UploadedFiles() files: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const file =
            files?.file?.[0] ||
            files?.image?.[0] ||
            files?.profile_picture?.[0];

        if (!file) {
            throw new BadRequestException(
                'Profile image file is required. Use one of these form-data keys: file, image, profile_picture',
            );
        }

        const profilePictureUrl = await this.cloudinaryService.uploadProfileImage(
            file,
            'doctors',
            doctor._id,
        );

        const data = await this.doctorService.updateProfilePicture(doctor._id, profilePictureUrl);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('patients')
    @UseGuards(RolesGuard)
    @Roles(Role.DOCTOR)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Fetch all patients in the system (with optional search)',
        description: 'Returns a paginated list of all patients. Each patient includes their most recent consultation_id (null if none) and has_consultation_with_doctor (whether they have any consultation with the logged-in doctor). Searchable by name, email, phone, registration number, or date of birth.',
    })
    @ApiQuery({ name: 'q', required: false, description: 'Search by name, email, phone, registration number or date of birth (YYYY-MM-DD)' })
    @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)', example: 1 })
    @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20)', example: 20 })
    @ApiResponse({
        status: 200,
        description: 'Patients retrieved successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    patients: [
                        {
                            _id: '64f3abc123def456',
                            first_name: 'John',
                            last_name: 'Doe',
                            full_name: 'John Doe',
                            email: 'john.doe@example.com',
                            phone_number: '+2348012345678',
                            registration_no: 'REG-00123',
                            mrn: 'C-3622ET',
                            gender: 'MALE',
                            date_of_birth: '1990-05-12T00:00:00.000Z',
                            marital_status: 'SINGLE',
                            occupation: 'Engineer',
                            address: '12 Lagos Street, Abuja',
                            profile_picture_url: 'https://res.cloudinary.com/example/image.jpg',
                            verified: true,
                            consultation_id: '64f3abc000aaa111',
                            has_consultation_with_doctor: true,
                            createdAt: '2026-01-10T08:00:00.000Z',
                            updatedAt: '2026-03-15T12:00:00.000Z',
                        },
                        {
                            _id: '64f3xyz789ghi000',
                            first_name: 'Jane',
                            last_name: 'Smith',
                            full_name: 'Jane Smith',
                            email: 'jane.smith@example.com',
                            phone_number: '+2348098765432',
                            registration_no: 'REG-00124',
                            verified: true,
                            consultation_id: null,
                            has_consultation_with_doctor: false,
                            createdAt: '2026-02-01T09:00:00.000Z',
                            updatedAt: '2026-02-01T09:00:00.000Z',
                        },
                    ],
                    pagination: {
                        total: 21,
                        page: 1,
                        limit: 20,
                        total_pages: 2,
                    },
                },
            },
        },
    })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    @ApiResponse({ status: 403, description: 'Forbidden — only doctors can access this endpoint' })
    async getAllPatients(
        @CurrentUser() doctor: any,
        @Query('q') q: string,
        @Query('page') page: string,
        @Query('limit') limit: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.usersService.getPatientsWithSearch(
            q,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
            doctor?._id?.toString(),
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch(':id/activate')
    @ApiExcludeEndpoint()
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    async activate(
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.doctorService.activate(id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch(':id/deactivate')
    @ApiExcludeEndpoint()
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    async deactivate(
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.doctorService.deactivate(id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }
}

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
    ApiBody,
    ApiBearerAuth,
    ApiConsumes,
    ApiExcludeEndpoint,
    ApiOperation,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CoreController } from 'src/common/core/controller.core';
import { UsersService } from './users.service';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles, CurrentUser } from 'src/common/decorators';
import { Role } from 'src/common/enums';
import { UpdatePatientProfileDto } from './dto/update-user-profile.dto';
import { UpdateTimezoneDto } from './dto/update-timezone.dto';
import { UpdateProfilePictureDto } from 'src/common/core/dto/update-profile-picture.dto';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

@ApiTags('Patients')
@Controller('patients')
export class UsersController extends CoreController {
    constructor(
        private readonly userService: UsersService,
        private readonly cloudinaryService: CloudinaryService,
    ) {
        super()
    }

    @Get('me')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    async fetchLoggedInUser(
        @CurrentUser() user: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.getUserSummary(user._id)
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('me/profile')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'View full logged-in patient profile' })
    @ApiResponse({ status: 200, description: 'Full profile fetched successfully' })
    async fetchLoggedInUserProfile(
        @CurrentUser() user: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.getUser(user._id)
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('me/metrics')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get pending metrics for logged-in patient',
        description:
            'Returns pending counts: consultations not yet completed or canceled, active medications in open consultations, investigations awaiting result uploads, and upcoming appointments.',
    })
    @ApiResponse({
        status: 200,
        description: 'Patient pending metrics fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    consultations: 2,
                    medications: 4,
                    investigations: 3,
                    appointments: 1,
                },
            },
        },
    })
    async getMyMetrics(
        @CurrentUser() user: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.getPatientMetrics(user._id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Edit logged-in patient profile' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                middle_name: { type: 'string' },
                phone_number: { type: 'string' },
                date_of_birth: { type: 'string', format: 'date-time' },
                gender: { type: 'string' },
                marital_status: { type: 'string' },
                occupation: { type: 'string' },
                address: { type: 'string' },
                allergies: { type: 'array', items: { type: 'string' } },
                previous_medical_conditions: { type: 'array', items: { type: 'string' } },
                medical_flags: { type: 'array', items: { type: 'string' } },
                file: { type: 'string', format: 'binary' },
                image: { type: 'string', format: 'binary' },
                profile_picture: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiResponse({ status: 200, description: 'Profile updated successfully' })
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
    async updateProfile(
        @CurrentUser() user: any,
        @Body() payload: UpdatePatientProfileDto,
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
                'patients',
                user._id,
            );
        }

        const data = await this.userService.updateProfile(user._id, payload)
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me/profile')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Edit logged-in patient profile (alias route)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                middle_name: { type: 'string' },
                phone_number: { type: 'string' },
                date_of_birth: { type: 'string', format: 'date-time' },
                gender: { type: 'string' },
                marital_status: { type: 'string' },
                occupation: { type: 'string' },
                address: { type: 'string' },
                allergies: { type: 'array', items: { type: 'string' } },
                previous_medical_conditions: { type: 'array', items: { type: 'string' } },
                medical_flags: { type: 'array', items: { type: 'string' } },
                file: { type: 'string', format: 'binary' },
                image: { type: 'string', format: 'binary' },
                profile_picture: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiResponse({ status: 200, description: 'Profile updated successfully' })
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
    async updateProfileAlias(
        @CurrentUser() user: any,
        @Body() payload: UpdatePatientProfileDto,
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
                'patients',
                user._id,
            );
        }

        const data = await this.userService.updateProfile(user._id, payload)
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me/timezone')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Set timezone for logged-in patient' })
    @ApiBody({ type: UpdateTimezoneDto })
    @ApiResponse({ status: 200, description: 'Timezone updated successfully' })
    async updateTimezone(
        @CurrentUser() user: any,
        @Body() payload: UpdateTimezoneDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.updateTimezone(user._id, payload.timezone);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('me/profile-picture')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    async updateProfilePicture(
        @CurrentUser() user: any,
        @Body() payload: UpdateProfilePictureDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.updateProfilePicture(
            user._id,
            payload.profile_picture_url,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('me/profile-picture/upload')
    @UseGuards(RolesGuard)
    @Roles(Role.PATIENT)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Upload patient profile picture to Cloudinary' })
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
    async uploadProfilePicture(
        @CurrentUser() user: any,
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
            'patients',
            user._id,
        );

        const data = await this.userService.updateProfilePicture(user._id, profilePictureUrl);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('search')
    @ApiExcludeEndpoint()
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    async searchPatients(
        @Query('q') q: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.searchPatients(q);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get(':id')
    @ApiExcludeEndpoint()
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    async getPatientById(
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.getPatientById(id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch(':id/profile')
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Edit a patient profile by id (Admin only)' })
    @ApiResponse({ status: 200, description: 'Profile updated successfully' })
    async adminUpdatePatientProfile(
        @Param('id') id: string,
        @Body() payload: UpdatePatientProfileDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.userService.updateProfile(id, payload);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }
}

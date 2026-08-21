import { BadRequestException, Body, Controller, DefaultValuePipe, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiExcludeEndpoint, ApiOperation, ApiParam, ApiResponse, ApiQuery, ApiBearerAuth, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { CoreController } from 'src/common/core/controller.core';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators';
import { Role } from 'src/common/enums';
import { ConsultationsService } from '../consultations.service';
import { CoreSearchFilterDatePaginationDto } from 'src/common/core/dto.core';
import { CreateCompliantHistoryDto } from '../dto/create-history.dto';

@ApiTags('Patient Consultations')
@Controller('patients/consultations')
@UseGuards(RolesGuard)
@Roles(Role.PATIENT)
export class PatientsController extends CoreController {
    constructor(
        private readonly consultationsService: ConsultationsService
    ) {
        super();
    }

    @Get()
    async getConsultation(@Res({ passthrough: true }) res: Response, @Req() req, @Query() query: CoreSearchFilterDatePaginationDto) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.findPatientConsultation(patients_id, query);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/all')
    async getAllConsultation(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
        @Query() query: CoreSearchFilterDatePaginationDto,
    ) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.findPatientConsultation(patients_id, query);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/investigation/list')
    @ApiExcludeEndpoint()
    async getPatientInvestigation(@Res({ passthrough: true }) res: Response, @Req() req, @Query() query: CoreSearchFilterDatePaginationDto) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.findPatientInvestigation(patients_id, query);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/diagnosis/list')
    @ApiExcludeEndpoint()
    async getPatientDiagnosis(@Res({ passthrough: true }) res: Response, @Req() req, @Query() query: CoreSearchFilterDatePaginationDto) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.findPatientDiagnosis(patients_id, query);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // Medications for a specific consultation (existing)
    @Get('/medication/:consultation_id')
    @ApiExcludeEndpoint()
    async getPatientMedication(@Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.findPatientMedication(patients_id, consultation_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // Medications for a single consultation grouped by formulary
    @Get('/:consultation_id/medications/grouped')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get medications for a consultation grouped by formulary',
        description:
            'Returns all medications prescribed in the given consultation for the ' +
            'authenticated patient, bucketed by their formulary (TABLET, CAPSULE, SYRUP, INJECTION, ...). ' +
            'Each group includes a `count` and the ordered list of medication records.',
    })
    @ApiParam({ name: 'consultation_id', description: 'Consultation id', example: '64f3abc000aaa111' })
    @ApiResponse({
        status: 200,
        description: 'Grouped medications fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    consultation_id: '64f3abc000aaa111',
                    total: 3,
                    groups: [
                        {
                            formulary: 'TABLET',
                            count: 2,
                            medications: [
                                {
                                    _id: '64f3abc123def456',
                                    formulary: 'TABLET',
                                    medication: 'Paracetamol',
                                    dose: 500,
                                    unit: 'MILLIGRAM',
                                    interval: 'DAILY',
                                    duration: 5,
                                    duration_unit: 'DAYS',
                                    status: 'ACTIVE',
                                },
                            ],
                        },
                        {
                            formulary: 'SYRUP',
                            count: 1,
                            medications: [
                                {
                                    _id: '64f3abc123def999',
                                    formulary: 'SYRUP',
                                    medication: 'Cough Syrup',
                                    dose: 10,
                                    unit: 'MLS',
                                    interval: 'DAILY',
                                    duration: 7,
                                    duration_unit: 'DAYS',
                                    status: 'ACTIVE',
                                },
                            ],
                        },
                    ],
                },
            },
        },
    })
    @ApiResponse({ status: 400, description: 'Invalid consultation' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getGroupedMedicationByConsultation(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
        @Param('consultation_id') consultation_id: string,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findGroupedPatientMedicationByConsultation(patient_id, consultation_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // All medications across all consultations — optional ?status=ACTIVE filter
    @Get('/medications')
    async getAllMedications(@Res({ passthrough: true }) res: Response, @Req() req, @Query('status') status?: string) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findAllPatientMedications(patient_id, status);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // Only active medications
    @Get('/medications/active')
    async getActiveMedications(@Res({ passthrough: true }) res: Response, @Req() req) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findAllPatientMedications(patient_id, 'ACTIVE');
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/medications/grouped-by-consultation')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get patient medications grouped by consultation',
        description:
            'Returns all medications assigned to the authenticated patient, grouped by consultation_id. ' +
            'Paginated by consultation groups.',
    })
    @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
    @ApiQuery({ name: 'perPage', required: false, type: Number, example: 20 })
    @ApiResponse({ status: 200, description: 'Medications grouped by consultation fetched successfully' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getPatientMedicationsGroupedByConsultation(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.getPatientMedicationsGroupedByConsultation(
            patient_id,
            page,
            perPage,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // Single medication by ID
    @Get('/medications/:id')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get a single medication by ID', description: 'Returns full details of a specific medication prescribed to the authenticated patient.' })
    @ApiParam({ name: 'id', description: 'The medication document ID', example: '64f3abc123def456' })
    @ApiResponse({
        status: 200,
        description: 'Medication retrieved successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    _id: '64f3abc123def456',
                    medication: 'Amoxicillin',
                    formulary: 'CAPSULE',
                    dose: 500,
                    unit: 'MILLIGRAM',
                    interval: 'DAILY',
                    duration: 7,
                    duration_unit: 'DAY',
                    assign_to_patient: true,
                    status: 'ACTIVE',
                    consultation_id: {
                        _id: '64f3abc000aaa111',
                        title: 'General Consultation',
                        type: 'VIDEO',
                        status: 'COMPLETED',
                        createdAt: '2026-04-01T10:00:00.000Z',
                    },
                    doctor_id: {
                        _id: '69b36d3b1cb13077cdecca3c',
                        full_name: 'Dr. Emeka Okafor',
                        first_name: 'Emeka',
                        last_name: 'Okafor',
                        specializations: ['General Practice'],
                    },
                    createdAt: '2026-04-01T10:30:00.000Z',
                    updatedAt: '2026-04-01T10:30:00.000Z',
                },
            },
        },
    })
    @ApiResponse({ status: 404, description: 'Medication not found' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getSingleMedication(@Res({ passthrough: true }) res: Response, @Req() req, @Param('id') id: string) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findSinglePatientMedication(patient_id, id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/compliant-history/:consultation_id')
    @ApiExcludeEndpoint()
    async createCompliantHistory(@Body() createCompliantHistory: CreateCompliantHistoryDto, @Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.createCompliantHistory(createCompliantHistory, patients_id, consultation_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    @Get('/compliant-history/:consultation_id')
    @ApiExcludeEndpoint()
    async getComplaintHistory(@Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.getCompliantHistory(patients_id, consultation_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    @Delete('/compliant-history/:id')
    @ApiExcludeEndpoint()
    async deleteCompliantHistory(@Res({ passthrough: true }) res: Response, @Req() req, @Param('id') id: string) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.deleteCompliantHistory(id, patients_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    @Get("/physical-exam/:consultation_id")
    @ApiExcludeEndpoint()
    async getPatientPhysicalExam(@Res({ passthrough: true }) res: Response, @Req() req, @Query() query: CoreSearchFilterDatePaginationDto, @Param('consultation_id') consultation_id: string) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.findPatientPhysicalExam(patients_id, consultation_id, query);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('consultation/weekly')
    async getWeeklyConsultation(@Res({ passthrough: true }) res: Response, @Req() req) {
        const patients_id = req.patient._id;
        const data = await this.consultationsService.getWeeklyPatientConsultation(patients_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/investigations/grouped')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get patient investigation lists grouped by consultation',
        description:
            'Returns all investigation list items assigned to the authenticated patient, grouped by consultation. ' +
            'Paginated by number of consultation groups. Sorted by most recent first.',
    })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
    @ApiQuery({ name: 'perPage', required: false, type: Number, description: 'Groups per page (default: 20)', example: 20 })
    @ApiResponse({
        status: 200,
        description: 'Investigation lists grouped by consultation fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    groups: [
                        {
                            consultation: {
                                _id: '64f3abc000aaa111',
                                title: 'General Consultation',
                                type: 'VIDEO',
                                consoltation_for: 'SELF',
                                status: 'COMPLETED',
                                session_number: 'SESS-001',
                                consultation_id: 'BOOK-X8F2K9LQ',
                                doctor_id: {
                                    _id: '69b36d3b1cb13077cdecca3c',
                                    first_name: 'Emeka',
                                    last_name: 'Okafor',
                                    full_name: 'Dr. Emeka Okafor',
                                    email: 'emeka@example.com',
                                    specializations: ['General Practice'],
                                    profile_picture_url: null,
                                },
                                appointment_id: {
                                    appointment_number: 'APT-20260320-4738',
                                    scheduled_start_at_utc: '2026-03-20T09:00:00.000Z',
                                    scheduled_end_at_utc: '2026-03-20T09:30:00.000Z',
                                    status: 'COMPLETED',
                                    reason_for_visit: 'Headache',
                                },
                                createdAt: '2026-03-20T09:00:00.000Z',
                                updatedAt: '2026-03-20T10:00:00.000Z',
                            },
                            investigation_count: 2,
                            investigations: [
                                {
                                    _id: '64f3abc123def456',
                                    name: 'Full Blood Count',
                                    assign_to_patient: true,
                                    user_id: '64f3abc789ghi000',
                                    consultation_id: '64f3abc000aaa111',
                                    doctor_id: {
                                        _id: '69b36d3b1cb13077cdecca3c',
                                        first_name: 'Emeka',
                                        last_name: 'Okafor',
                                        full_name: 'Dr. Emeka Okafor',
                                        email: 'emeka@example.com',
                                        specializations: ['General Practice'],
                                        profile_picture_url: null,
                                    },
                                    createdAt: '2026-03-20T09:15:00.000Z',
                                    updatedAt: '2026-03-20T09:15:00.000Z',
                                },
                                {
                                    _id: '64f3abc123def789',
                                    name: 'Urinalysis',
                                    assign_to_patient: true,
                                    user_id: '64f3abc789ghi000',
                                    consultation_id: '64f3abc000aaa111',
                                    doctor_id: {
                                        _id: '69b36d3b1cb13077cdecca3c',
                                        first_name: 'Emeka',
                                        last_name: 'Okafor',
                                        full_name: 'Dr. Emeka Okafor',
                                        email: 'emeka@example.com',
                                        specializations: ['General Practice'],
                                        profile_picture_url: null,
                                    },
                                    createdAt: '2026-03-20T09:16:00.000Z',
                                    updatedAt: '2026-03-20T09:16:00.000Z',
                                },
                            ],
                        },
                    ],
                    pagination: {
                        total: 1,
                        page: 1,
                        perPage: 20,
                        total_pages: 1,
                    },
                },
            },
        },
    })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getPatientInvestigationsGrouped(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.getPatientInvestigationListsGroupedByConsultation(
            patient_id,
            page,
            perPage,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/:consultation_id/investigation-list')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get all patient investigation list items for a single consultation',
        description:
            'Returns all investigation list items assigned to the authenticated patient for one consultation.',
    })
    @ApiParam({ name: 'consultation_id', description: 'Consultation document ID' })
    @ApiResponse({ status: 200, description: 'Consultation investigation list fetched successfully' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getPatientInvestigationListByConsultation(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
        @Param('consultation_id') consultation_id: string,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.getPatientInvestigationListsByConsultation(
            patient_id,
            consultation_id,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Patch('/investigation-list/:id/upload')
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @ApiOperation({
        summary: 'Upload images attached to an investigation list item',
        description: 'Patient uploads one or more result images (e.g. scanned lab reports) tied to a specific InvestigationList item. Accepts multipart/form-data with keys: files, images, or result_images (up to 10 files per request).',
    })
    @ApiParam({ name: 'id', description: 'InvestigationList document ID' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string', format: 'binary' } },
            },
        },
    })
    @ApiResponse({ status: 200, description: 'Images uploaded and attached' })
    @ApiResponse({ status: 400, description: 'Missing files or invalid id' })
    @ApiResponse({ status: 401, description: 'Unauthorized — not your investigation' })
    @ApiResponse({ status: 404, description: 'Investigation not found' })
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'files', maxCount: 10 },
                { name: 'images', maxCount: 10 },
                { name: 'result_images', maxCount: 10 },
            ],
            { limits: { fileSize: 10 * 1024 * 1024 } },
        ),
    )
    async uploadInvestigationImage(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
        @Param('id') id: string,
        @UploadedFiles() files: any,
    ) {
        const fileList: any[] = [
            ...(files?.files || []),
            ...(files?.images || []),
            ...(files?.result_images || []),
        ];
        if (!fileList.length) {
            throw new BadRequestException(
                'At least one image file is required. Use one of these form-data keys: files, images, result_images',
            );
        }
        const patient_id = req.patient._id;
        const data = await this.consultationsService.uploadInvestigationListImages(patient_id, id, fileList);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // ---------- Referrals (read-only) ----------

    @Get('/:consultation_id/referrals')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List referrals for a consultation (patient only)',
        description: 'Returns all referrals written by doctors for the authenticated patient on the given consultation, newest first.',
    })
    @ApiParam({ name: 'consultation_id', description: 'Consultation id', example: '64f3abc000aaa111' })
    @ApiResponse({
        status: 200,
        description: 'Referrals fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: [
                    {
                        _id: '64f3ref000bbb222',
                        specialist_name: 'Dr. Jane Okafor',
                        hospital: 'Lagos University Teaching Hospital',
                        referral_details: 'Patient presents with persistent chest pain. Please evaluate for cardiac involvement.',
                        consultation_id: '64f3abc000aaa111',
                        user_id: '64f3pat000ccc333',
                        doctor_id: {
                            _id: '64f3doc000ddd444',
                            full_name: 'Dr. John Smith',
                            specializations: ['General Practice'],
                        },
                        createdAt: '2026-04-21T10:00:00.000Z',
                        updatedAt: '2026-04-21T10:00:00.000Z',
                    },
                ],
            },
        },
    })
    @ApiResponse({ status: 400, description: 'Invalid consultation — does not belong to this patient' })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getReferralsByConsultation(
        @Param('consultation_id') consultation_id: string,
        @Res({ passthrough: true }) res: Response,
        @Req() req,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findPatientReferralsByConsultation(patient_id, consultation_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/referrals')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List all referrals for the authenticated patient (paginated)',
        description: 'Returns every referral written by any doctor for the authenticated patient across all consultations, newest first. Each referral has `consultation_id` and `doctor_id` populated.',
    })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
    @ApiQuery({ name: 'perPage', required: false, type: Number, description: 'Items per page (default: 10)', example: 10 })
    @ApiResponse({
        status: 200,
        description: 'Referrals fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    referrals: [
                        {
                            _id: '64f3ref000bbb222',
                            specialist_name: 'Dr. Jane Okafor',
                            hospital: 'Lagos University Teaching Hospital',
                            referral_details: 'Patient presents with persistent chest pain. Please evaluate for cardiac involvement.',
                            consultation_id: {
                                _id: '64f3abc000aaa111',
                                title: 'Video Consultation',
                                type: 'VIDEO',
                                consoltation_for: 'Self',
                                status: 'COMPLETED',
                                session_number: 1,
                                createdAt: '2026-04-21T09:50:00.000Z',
                                updatedAt: '2026-04-21T10:20:00.000Z',
                            },
                            user_id: '64f3pat000ccc333',
                            doctor_id: {
                                _id: '64f3doc000ddd444',
                                full_name: 'Dr. John Smith',
                                specializations: ['General Practice'],
                                profile_picture_url: null,
                            },
                            createdAt: '2026-04-21T10:00:00.000Z',
                            updatedAt: '2026-04-21T10:00:00.000Z',
                        },
                    ],
                    meta: {
                        total: 1,
                        page: 1,
                        perPage: 10,
                        lastPage: 1,
                    },
                },
            },
        },
    })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getAllPatientReferrals(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
        @Query() query: CoreSearchFilterDatePaginationDto,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findAllPatientReferrals(patient_id, query);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/referrals/grouped')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List referrals grouped by consultation (patient only)',
        description:
            'Returns all referrals for the authenticated patient grouped by consultation, newest groups first.',
    })
    @ApiResponse({
        status: 200,
        description: 'Grouped referrals fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: [
                    {
                        consultation: {
                            _id: '64f3abc000aaa111',
                            title: 'Video Consultation',
                            type: 'VIDEO',
                            consoltation_for: 'Self',
                            status: 'COMPLETED',
                            session_number: 1,
                            createdAt: '2026-04-21T09:50:00.000Z',
                            updatedAt: '2026-04-21T10:20:00.000Z',
                        },
                        referrals: [
                            {
                                _id: '64f3ref000bbb222',
                                specialist_name: 'Dr. Jane Okafor',
                                hospital: 'Lagos University Teaching Hospital',
                                referral_details: 'Patient presents with persistent chest pain. Please evaluate for cardiac involvement.',
                                consultation_id: '64f3abc000aaa111',
                                user_id: '64f3pat000ccc333',
                                doctor_id: {
                                    _id: '64f3doc000ddd444',
                                    full_name: 'Dr. John Smith',
                                    specializations: ['General Practice'],
                                    profile_picture_url: null,
                                },
                                createdAt: '2026-04-21T10:00:00.000Z',
                                updatedAt: '2026-04-21T10:00:00.000Z',
                            },
                        ],
                    },
                ],
            },
        },
    })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    async getGroupedPatientReferrals(
        @Res({ passthrough: true }) res: Response,
        @Req() req,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findGroupedPatientReferrals(patient_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('/referrals/:referral_id')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get a single referral (patient only)',
        description: "Fetches one referral. Scoped to the authenticated patient — returns 404 for referrals that don't belong to them.",
    })
    @ApiParam({ name: 'referral_id', description: 'Referral id', example: '64f3ref000bbb222' })
    @ApiResponse({
        status: 200,
        description: 'Referral fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    _id: '64f3ref000bbb222',
                    specialist_name: 'Dr. Jane Okafor',
                    hospital: 'Lagos University Teaching Hospital',
                    referral_details: 'Patient presents with persistent chest pain. Please evaluate for cardiac involvement.',
                    consultation_id: {
                        _id: '64f3abc000aaa111',
                        title: 'Video Consultation',
                        type: 'VIDEO',
                        status: 'COMPLETED',
                        createdAt: '2026-04-21T09:50:00.000Z',
                    },
                    user_id: '64f3pat000ccc333',
                    doctor_id: {
                        _id: '64f3doc000ddd444',
                        full_name: 'Dr. John Smith',
                        specializations: ['General Practice'],
                    },
                    createdAt: '2026-04-21T10:00:00.000Z',
                    updatedAt: '2026-04-21T10:00:00.000Z',
                },
            },
        },
    })
    @ApiResponse({ status: 401, description: 'Unauthorized — invalid or missing token' })
    @ApiResponse({ status: 404, description: 'Referral not found' })
    async getSingleReferral(
        @Param('referral_id') referral_id: string,
        @Res({ passthrough: true }) res: Response,
        @Req() req,
    ) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.findPatientSingleReferral(patient_id, referral_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // Keep this LAST — wildcard will catch any /:consultation_id only after all specific routes above are checked
    @Get('/:consultation_id')
    async getSingleConsultation(@Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
        const patient_id = req.patient._id;
        const data = await this.consultationsService.singleConsultion(consultation_id, patient_id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }
}

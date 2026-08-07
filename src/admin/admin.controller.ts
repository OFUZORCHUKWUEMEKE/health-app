import {
    Body,
    Controller,
    Get,
    HttpStatus,
    Param,
    Post,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
    ApiBearerAuth,
    ApiBody,
    ApiExcludeController,
    ApiOperation,
    ApiQuery,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { CoreController } from 'src/common/core/controller.core';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators';
import { Role } from 'src/common/enums';
import { UsersService } from 'src/users/users.service';
import { AdminService } from './admin.service';
import { CreateDoctorDto } from 'src/doctors/dto/create-doctor';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminController extends CoreController {
    constructor(
        private readonly usersService: UsersService,
        private readonly adminService: AdminService,
    ) {
        super();
    }

    @Post('doctors')
    @ApiOperation({ summary: 'Create doctor account (Admin only)' })
    @ApiBody({ type: CreateDoctorDto })
    @ApiResponse({ status: 201, description: 'Doctor created successfully' })
    @ApiResponse({ status: 409, description: 'Doctor already exists' })
    async createDoctor(
        @Body() dto: CreateDoctorDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.adminService.createDoctor(dto);
        return this.responseSuccess(res, '00', 'Doctor created successfully', data, HttpStatus.CREATED);
    }

    @Get('patients')
    @ApiOperation({ summary: 'View all patients (Admin only)' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Patients fetched successfully' })
    async getAllPatients(
        @Query('page') page: string,
        @Query('limit') limit: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const data = await this.usersService.getAllPatients(pageNum, limitNum);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('doctors')
    @ApiOperation({ summary: 'View all doctors (Admin only)' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Doctors fetched successfully' })
    async getAllDoctors(
        @Query('page') page: string,
        @Query('limit') limit: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const data = await this.adminService.getAllDoctors(pageNum, limitNum);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('patients/:id')
    @ApiOperation({ summary: 'View a single patient by ID (Admin only)' })
    @ApiResponse({ status: 200, description: 'Patient fetched successfully' })
    @ApiResponse({ status: 404, description: 'Patient not found' })
    async getPatientById(
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.usersService.getPatientById(id);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Get('metrics')
    @ApiOperation({ summary: 'Get system metrics (Admin only)' })
    @ApiResponse({
        status: 200,
        description: 'Metrics fetched successfully',
        schema: {
            example: {
                success: true,
                response_code: '00',
                response_description: 'Success',
                data: {
                    consultations: 120,
                    medications: 240,
                    investigations: 80,
                    appointments: 300,
                },
            },
        },
    })
    async getMetrics(@Res({ passthrough: true }) res: Response) {
        const data = await this.adminService.getSystemMetrics();
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }
}

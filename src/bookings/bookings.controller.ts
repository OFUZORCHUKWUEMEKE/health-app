import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Types } from 'mongoose';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CoreController } from 'src/common/core/controller.core';
import { Roles, CurrentUser } from 'src/common/decorators';
import { Role } from 'src/common/enums';
import { RolesGuard } from 'src/common/guards/roles.guard';
import {
  SystemAvailabilityQueryDto,
  AvailableDoctorsQueryDto,
  CheckDoctorAvailabilityQueryDto,
  FindOptimalDoctorQueryDto,
  CreatePatientAppointmentDto,
  CreateDoctorBlackoutsDto,
  DoctorScheduleQueryDto,
  DoctorApprovedAppointmentsQueryDto,
  DoctorAvailabilitySlotsQueryDto,
  DoctorAppointmentActionDto,
  DoctorAppointmentsQueryDto,
  PatientAppointmentsQueryDto,
  PatientCancelAppointmentDto,
  RescheduleAppointmentDto,
  UpsertDoctorAvailabilityDto,
} from './dto/doctor-bookings.dto';
import { BookingsService } from './bookings.service';

const availabilityResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    _id: '67d4f40c0dc8b8aa6d9f1001',
    doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
    timezone: 'Africa/Lagos',
    weekly_slots: [
      {
        day_of_week: 1,
        start_time: '09:00',
        end_time: '13:00',
        slot_duration_minutes: 30,
        is_active: true,
      },
    ],
  },
  request_id: '9a81d4df-4530-4e67-b74b-01f7c83a4df8',
  path: '/api/v1/doctors/me/availability',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const doctorAppointmentsResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    items: [
      {
        _id: '67d5006d0dc8b8aa6d9f2001',
        appointment_number: 'APT-20260315-0001',
        doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
        patient_id: '67d4f2af0dc8b8aa6d9f0bbb',
        scheduled_start_at_utc: '2026-03-20T09:00:00.000Z',
        scheduled_end_at_utc: '2026-03-20T09:30:00.000Z',
        timezone_snapshot: 'Africa/Lagos',
        status: 'PENDING',
        reason_for_visit: 'Follow up review',
      },
    ],
    pagination: {
      page: 1,
      perPage: 20,
      total: 1,
      totalPages: 1,
    },
  },
  request_id: 'f84325b2-c764-4fe0-8d66-40f7eeec4f9f',
  path: '/api/v1/doctors/me/appointments?page=1&perPage=20',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const allDoctorAppointmentsResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: [
    {
      _id: '67d5006d0dc8b8aa6d9f2002',
      appointment_number: 'APT-20260315-0001',
      doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
      patient_id: '67d4f2af0dc8b8aa6d9f0bbb',
      scheduled_start_at_utc: '2026-03-20T10:00:00.000Z',
      scheduled_end_at_utc: '2026-03-20T10:30:00.000Z',
      timezone_snapshot: 'Africa/Lagos',
      status: 'CONFIRMED',
      reason_for_visit: 'Follow up review',
      complaint_brief: 'Medication review',
      Medical_conditions: ['Hypertension'],
      allergies: [],
      booking_profile_snapshot: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        date_of_birth: '1990-01-01T00:00:00.000Z',
        gender: 'female',
        marital_status: 'single',
        occupation: 'Engineer',
        present_complaint: 'Follow up review',
      },
      consultation_id: {
        _id: '67d6006d0dc8b8aa6d9f3001',
        appointment_id: '67d5006d0dc8b8aa6d9f2002',
        type: 'VIDEO',
        title: 'Follow up review',
        details: 'Consultation notes',
        status: 'OPEN',
        consultation_id: 'CON-20260320-0001',
        createdAt: '2026-03-15T10:00:00.000Z',
        updatedAt: '2026-03-15T10:00:00.000Z',
      },
      rescheduled_from_appointment_id: '67d5006d0dc8b8aa6d9f2001',
      createdAt: '2026-03-15T10:00:00.000Z',
      updatedAt: '2026-03-15T10:05:00.000Z',
      rescheduled_history: [
        {
          _id: '67d5006d0dc8b8aa6d9f2001',
          appointment_number: 'APT-20260315-0001',
          doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
          patient_id: '67d4f2af0dc8b8aa6d9f0bbb',
          scheduled_start_at_utc: '2026-03-20T09:00:00.000Z',
          scheduled_end_at_utc: '2026-03-20T09:30:00.000Z',
          timezone_snapshot: 'Africa/Lagos',
          status: 'RESCHEDULED',
          reason_for_visit: 'Follow up review',
          cancelled_by: 'patient',
          cancelled_reason: 'Need a later time',
          createdAt: '2026-03-15T09:00:00.000Z',
          updatedAt: '2026-03-15T10:05:00.000Z',
        },
      ],
    },
  ],
  request_id: 'f84325b2-c764-4fe0-8d66-40f7eeec4f9f',
  path: '/api/v1/booking/doctors/me/appointments/all',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const doctorApprovedAppointmentsWeeklyResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    filter: {
      status: 'CONFIRMED',
      weekly: 10,
      year: 2026,
    },
    total: 2,
    groups: [
      {
        week: 10,
        year: 2026,
        start_at_utc: '2026-03-02T00:00:00.000Z',
        end_at_utc: '2026-03-09T00:00:00.000Z',
        items: [
          {
            _id: '67d5006d0dc8b8aa6d9f2001',
            appointment_number: 'APT-20260305-0001',
            status: 'CONFIRMED',
            scheduled_start_at_utc: '2026-03-05T09:00:00.000Z',
            scheduled_end_at_utc: '2026-03-05T09:30:00.000Z',
          },
        ],
      },
    ],
  },
  request_id: 'f84325b2-c764-4fe0-8d66-40f7eeec4f9f',
  path: '/api/v1/booking/doctors/me/appointments/approved?weekly=10&year=2026',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const blackoutCreateResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: [
    {
      _id: '67d4f6b90dc8b8aa6d9f1555',
      doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
      start_at_utc: '2026-03-25T07:00:00.000Z',
      end_at_utc: '2026-03-25T16:00:00.000Z',
      timezone: 'Africa/Lagos',
      reason: 'Conference',
      reccuring: true,
    },
  ],
  request_id: '8f80e2de-19b6-45fc-9e43-3abfef8c4d2b',
  path: '/api/v1/doctors/me/blackouts',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const statusTransitionResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    _id: '67d5006d0dc8b8aa6d9f2001',
    status: 'CONFIRMED',
  },
  request_id: '2ddf6a77-f3a2-4a8b-b8cc-5d1d1cb8d7b7',
  path: '/api/v1/booking/appointments/67d5006d0dc8b8aa6d9f2001/confirm',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const rescheduleRequestExample = {
  scheduled_start_local: '2026-03-26T10:00:00',
  timezone: 'America/Edmonton',
  requested_duration_minutes: 30,
  reason: 'Need a different time',
};

const availableDoctorsResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: [
    {
      _id: '67d4f0be0dc8b8aa6d9f0aaa',
      first_name: 'Ada',
      last_name: 'Ifeanyi',
      full_name: 'Ada Ifeanyi',
      email: 'doctor@example.com',
      profile_picture_url: 'https://cdn.example.com/doctor.jpg',
      specializations: ['Cardiology'],
      active: true,
      availability: {
        timezone: 'Africa/Lagos',
        weekly_slots: [
          {
            day_of_week: 1,
            start_time: '09:00',
            end_time: '13:00',
            slot_duration_minutes: 30,
            is_active: true,
          },
        ],
        effective_from: '2026-03-20T00:00:00.000Z',
        effective_to: null,
      },
    },
  ],
  request_id: '5e222cdb-d7de-4f4f-b4f2-34f90a095b48',
  path: '/api/v1/booking/doctors/available?page=1&perPage=20',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const availableDoctorSlotsResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
    date: '2026-03-20',
    timezone: 'Africa/Lagos',
    slots: [
      {
        start_at_utc: '2026-03-20T09:00:00.000Z',
        end_at_utc: '2026-03-20T09:30:00.000Z',
      },
      {
        start_at_utc: '2026-03-20T09:30:00.000Z',
        end_at_utc: '2026-03-20T10:00:00.000Z',
      },
    ],
  },
  request_id: '0e0fd93d-430b-4608-a9f0-5af99c2f3289',
  path: '/api/v1/booking/doctors/67d4f0be0dc8b8aa6d9f0aaa/slots?date=2026-03-20',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const patientCreateAppointmentResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    _id: '67d5006d0dc8b8aa6d9f2001',
    appointment_number: 'APT-20260320-4738',
    patient_id: '67d4f2af0dc8b8aa6d9f0bbb',
    doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
    scheduled_start_at_utc: '2026-03-20T09:00:00.000Z',
    scheduled_end_at_utc: '2026-03-20T09:30:00.000Z',
    timezone_snapshot: 'Africa/Lagos',
    status: 'PENDING',
    reason_for_visit: 'Persistent headache for 3 days',
    complaint_brief: 'Mild headache and fatigue',
    Medical_conditions: ['Hypertension'],
    allergies: ['Penicillin'],
    booking_profile_snapshot: {
      first_name: 'Ada',
      last_name: 'Okafor',
      date_of_birth: '1994-05-11T00:00:00.000Z',
      gender: 'female',
      marital_status: 'single',
      occupation: 'Engineer',
      present_complaint: 'Persistent headache for 3 days',
    },
  },
  request_id: '84c9f44a-5f25-4d47-97e8-b808efe8f43f',
  path: '/api/v1/booking/patients/appointments',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const patientAppointmentsResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    items: [
      {
        _id: '67d5006d0dc8b8aa6d9f2001',
        appointment_number: 'APT-20260320-4738',
        doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
        patient_id: '67d4f2af0dc8b8aa6d9f0bbb',
        scheduled_start_at_utc: '2026-03-20T09:00:00.000Z',
        scheduled_end_at_utc: '2026-03-20T09:30:00.000Z',
        status: 'PENDING',
      },
    ],
    pagination: {
      page: 1,
      perPage: 20,
      total: 1,
      totalPages: 1,
    },
  },
  request_id: 'da6f44e0-b88e-40f7-8e07-8807806d35b0',
  path: '/api/v1/booking/patients/appointments?page=1&perPage=20',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const patientApprovedAppointmentsWeeklyResponseExample = {
  success: true,
  response_code: '00',
  response_description: 'Success',
  data: {
    filter: {
      status: 'CONFIRMED',
      weekly: 10,
      year: 2026,
    },
    total: 1,
    groups: [
      {
        week: 10,
        year: 2026,
        start_at_utc: '2026-03-02T00:00:00.000Z',
        end_at_utc: '2026-03-09T00:00:00.000Z',
        items: [
          {
            _id: '67d5006d0dc8b8aa6d9f2001',
            appointment_number: 'APT-20260305-0001',
            status: 'CONFIRMED',
            scheduled_start_at_utc: '2026-03-05T09:00:00.000Z',
            scheduled_end_at_utc: '2026-03-05T09:30:00.000Z',
          },
        ],
      },
    ],
  },
  request_id: 'da6f44e0-b88e-40f7-8e07-8807806d35b0',
  path: '/api/v1/booking/patients/appointments/approved?weekly=10&year=2026',
  timestamp: '2026-03-15T10:00:00.000Z',
};

const patientCreateAppointmentRequestExample = {
  first_name: 'Ada',
  last_name: 'Okafor',
  date_of_birth: '1994-05-11',
  gender: 'female',
  marital_status: 'single',
  occupation: 'Engineer',
  present_complaint: 'Persistent headache for 3 days',
  complaint_brief: 'Mild headache and fatigue',
  Medical_conditions: ['Hypertension'],
  allergies: ['Penicillin'],
  doctor_id: '67d4f0be0dc8b8aa6d9f0aaa',
  scheduled_start_local: '2026-03-20T09:00:00',
  timezone: 'America/Edmonton',
  requested_duration_minutes: 30,
  confirm_appointment: true,
};

@ApiTags('Bookings')
@Controller('booking')
export class BookingsController extends CoreController {
  constructor(private readonly bookingsService: BookingsService) {
    super();
  }

  @Get('doctors/available')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List available doctors for patient booking',
    description:
      'Returns active doctors that have configured availability. Supports search, specialization, date, and pagination filters.',
  })
  @ApiResponse({
    status: 200,
    description: 'Available doctors fetched successfully.',
    schema: { example: availableDoctorsResponseExample },
  })
  @ApiResponse({ status: 400, description: 'Invalid query filter.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async listAvailableDoctors(
    @Query() query: AvailableDoctorsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.listAvailableDoctors(query);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/search')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Search available doctors',
    description:
      'Searches active doctors with configured availability using q/specialization/date filters.',
  })
  @ApiResponse({
    status: 200,
    description: 'Available doctors search results fetched successfully.',
    schema: { example: availableDoctorsResponseExample },
  })
  @ApiResponse({ status: 400, description: 'Invalid query filter.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async searchAvailableDoctors(
    @Query() query: AvailableDoctorsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.listAvailableDoctors(query);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/find-optimal')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Find the optimal available doctor',
    description:
      'Searches all active doctors for the given date/time and duration. ' +
      'Returns the single best match — specialization-matched doctors are prioritized. ' +
      'Checks availability config, blackouts, and existing appointments.',
  })
  @ApiResponse({
    status: 200,
    description: 'Search result with optimal doctor or reason if none found.',
  })
  @ApiResponse({ status: 400, description: 'Invalid query params.' })
  async findOptimalDoctor(
    @Query() query: FindOptimalDoctorQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.findOptimalDoctor(
      query.datetime_local,
      query.timezone,
      query.duration,
      query.specialization,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/:doctorId/check-availability')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Check if a doctor is available at a specific date/time',
    description:
      'Returns whether the specified doctor is free at the given datetime and duration. ' +
      'Checks availability config, blackouts (one-time and recurring), and existing appointments.',
  })
  @ApiParam({ name: 'doctorId', description: 'Doctor id' })
  @ApiResponse({ status: 200, description: 'Availability check result.' })
  @ApiResponse({ status: 400, description: 'Invalid query params.' })
  @ApiResponse({ status: 404, description: 'Doctor not found.' })
  async checkDoctorAvailability(
    @Param('doctorId') doctorId: string,
    @Query() query: CheckDoctorAvailabilityQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.checkDoctorAvailability(
      doctorId,
      query.datetime_local,
      query.timezone,
      query.duration,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/:doctorId/slots')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get available slots for a doctor on a date',
    description:
      'Returns open slots for the specified doctor and date after excluding blackouts and already-booked times.',
  })
  @ApiParam({ name: 'doctorId', description: 'Doctor id' })
  @ApiResponse({
    status: 200,
    description: 'Available slots fetched successfully.',
    schema: { example: availableDoctorSlotsResponseExample },
  })
  @ApiResponse({ status: 400, description: 'Invalid date filter.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Doctor not found.' })
  async getDoctorAvailableSlots(
    @Param('doctorId') doctorId: string,
    @Query() query: DoctorAvailabilitySlotsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorAvailableSlots(
      doctorId,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Post('patients/appointments')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Book an appointment',
    description:
      'Creates a patient appointment. Supports two modes controlled by the BOOKING_MODE env variable:\n\n' +
      '- **auto** (default): System auto-matches an available doctor based on availability, blackouts, and conflicts. ' +
      '`doctor_id` is ignored; optionally supply `specialization` to prefer a specialist.\n' +
      '- **manual**: Patient must supply a `doctor_id`. The system validates the slot against that specific doctor.',
  })
  @ApiBody({
    type: CreatePatientAppointmentDto,
    description:
      'Booking payload: includes personal details, complaint, selected slot, and confirmation flag. ' +
      'In auto mode, doctor_id is optional. In manual mode, doctor_id is required.',
    schema: {
      example: patientCreateAppointmentRequestExample,
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Appointment booked successfully.',
    schema: { example: patientCreateAppointmentResponseExample },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid booking payload, slot, or no available doctor found.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Doctor not found (manual mode).' })
  @ApiResponse({
    status: 409,
    description: 'Selected slot is no longer available.',
  })
  async createPatientAppointment(
    @CurrentUser() patient: any,
    @Body() dto: CreatePatientAppointmentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.createPatientAppointment(
      patient._id,
      dto,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Post('patients/appointments/auto-book')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Auto-book appointment with fallback doctor',
    description:
      'Checks requested doctor availability first. If unavailable, automatically selects the next available doctor and books in one request.',
  })
  @ApiBody({
    type: CreatePatientAppointmentDto,
    description:
      'Booking payload. If doctor_id is unavailable, the system finds a fallback doctor for the same date/time and duration.',
    schema: {
      example: patientCreateAppointmentRequestExample,
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Appointment auto-booked successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload or no available doctor found.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async autoBookPatientAppointment(
    @CurrentUser() patient: any,
    @Body() dto: CreatePatientAppointmentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data =
      await this.bookingsService.createPatientAppointmentWithFallback(
        patient._id,
        dto,
      );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('slots/availability')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.DOCTOR, Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get system-wide availability matrix (per-slot doctor availability)',
    description:
      'Returns a day-by-day, slot-by-slot availability matrix for ALL active doctors. ' +
      'Each slot shows how many doctors are available and the longest consecutive free run. ' +
      'Blocked slots (existing bookings, blackouts) are excluded.',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    example: '2026-06-08',
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    example: '2026-06-14',
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'timezone',
    required: false,
    example: 'America/Edmonton',
    description: 'IANA timezone. Defaults to UTC.',
  })
  @ApiResponse({
    status: 200,
    description: 'System availability matrix fetched successfully.',
  })
  @ApiResponse({ status: 400, description: 'Invalid date range.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getAvailableDaysAndSlots(
    @Query() query: SystemAvailabilityQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getSystemAvailabilityMatrix(query);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('patients/schedule')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get patient schedule',
    description:
      "Returns the authenticated patient's appointments with populated doctor info. " +
      'Omit query params to fetch all appointments. Pass `weekly` + optional `year` to scope to a specific ISO week.',
  })
  @ApiQuery({
    name: 'weekly',
    required: false,
    description: 'ISO week number (1-53).',
    example: 15,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Year for the weekly filter. Defaults to current UTC year.',
    example: 2026,
  })
  @ApiResponse({ status: 200, description: 'Schedule fetched successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getPatientSchedule(
    @CurrentUser() patient: any,
    @Query() query: DoctorScheduleQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getPatientSchedule(
      patient._id,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('debug-history/:id')
  async debugHistory(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const h = await (this.bookingsService as any).appointmentsRepository
      .model()
      .find({ _id: new Types.ObjectId(id) })
      .lean();
    return res.json({ count: h.length, data: h });
  }

  @Get('patients/appointments')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List patient appointments',
    description:
      'Returns paginated appointments belonging to the authenticated patient with optional filters.',
  })
  @ApiResponse({
    status: 200,
    description: 'Patient appointments fetched successfully.',
    schema: { example: patientAppointmentsResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getPatientAppointments(
    @CurrentUser() patient: any,
    @Query() query: PatientAppointmentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getPatientAppointments(
      patient._id,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('patients/appointments/approved')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List approved appointments (patient)',
    description:
      'Returns only approved appointments (CONFIRMED) for the authenticated patient. Supports optional weekly grouping via weekly and year query params.',
  })
  @ApiResponse({
    status: 200,
    description: 'Approved appointments fetched successfully.',
    schema: { example: patientApprovedAppointmentsWeeklyResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getPatientApprovedAppointments(
    @CurrentUser() patient: any,
    @Query() query: DoctorApprovedAppointmentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getPatientApprovedAppointments(
      patient._id,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('patients/appointments/number/:appointmentNumber')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get patient appointments by appointment number',
    description:
      'Returns appointments with the given appointment number that belong to the authenticated patient. ' +
      'A rescheduled appointment can share the same appointment number, so this endpoint returns a list.',
  })
  @ApiParam({ name: 'appointmentNumber', description: 'Appointment number' })
  @ApiResponse({
    status: 200,
    description: 'Appointments fetched successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async getPatientAppointmentsByNumber(
    @CurrentUser() patient: any,
    @Param('appointmentNumber') appointmentNumber: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getPatientAppointmentsByNumber(
      patient._id,
      appointmentNumber,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('patients/appointments/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get patient appointment details',
    description:
      'Returns a single appointment that belongs to the authenticated patient, including linked consultation and rescheduled_history.',
  })
  @ApiParam({ name: 'id', description: 'Appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment details fetched successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async getPatientAppointmentById(
    @CurrentUser() patient: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getPatientAppointmentById(
      patient._id,
      id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('patients/appointments/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel patient appointment',
    description:
      'Cancels a pending/confirmed appointment that belongs to the authenticated patient.',
  })
  @ApiParam({ name: 'id', description: 'Appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment cancelled successfully.',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: {
          _id: '67d5006d0dc8b8aa6d9f2001',
          status: 'CANCELED',
          cancelled_by: 'patient',
          cancelled_reason: 'I am unavailable at that time',
        },
        request_id: '165f3cc1-5d97-4ce7-9a13-f893236fd381',
        path: '/api/v1/booking/patients/appointments/67d5006d0dc8b8aa6d9f2001/cancel',
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid cancellation state.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async cancelPatientAppointment(
    @CurrentUser() patient: any,
    @Param('id') id: string,
    @Body() dto: PatientCancelAppointmentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.cancelPatientAppointment(
      patient._id,
      id,
      dto,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('patients/appointments/:id/reschedule')
  @UseGuards(RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reschedule patient appointment',
    description:
      'Creates a new appointment for a new slot and marks the current one as RESCHEDULED for audit purposes.',
  })
  @ApiBody({
    type: RescheduleAppointmentDto,
    schema: { example: rescheduleRequestExample },
  })
  @ApiParam({ name: 'id', description: 'Current appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment rescheduled successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid reschedule payload or state.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  @ApiResponse({
    status: 409,
    description: 'Selected slot is no longer available.',
  })
  async reschedulePatientAppointment(
    @CurrentUser() patient: any,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.reschedulePatientAppointment(
      patient._id,
      id,
      dto,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Put('doctors/me/availability')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create or update doctor weekly availability',
    description:
      'Creates a new availability profile or replaces the existing one for the authenticated doctor.',
  })
  @ApiResponse({
    status: 200,
    description: 'Availability saved successfully.',
    schema: { example: availabilityResponseExample },
  })
  @ApiResponse({ status: 400, description: 'Invalid slot configuration.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async upsertDoctorAvailability(
    @CurrentUser() doctor: any,
    @Body() dto: UpsertDoctorAvailabilityDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.upsertDoctorAvailability(
      doctor._id,
      dto,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Post('doctors/me/availability/test-24-7')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Enable 24/7-like availability for testing',
    description:
      'Creates a test schedule for all days (Sunday-Saturday) from 00:00 to 23:45 with 15-minute slots. Optional timezone query param can be provided.',
  })
  @ApiResponse({
    status: 200,
    description: 'Test availability applied successfully.',
    schema: { example: availabilityResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async enableTestAlwaysOnAvailability(
    @CurrentUser() doctor: any,
    @Query('timezone') timezone = 'Africa/Lagos',
    @Res({ passthrough: true }) res: Response,
  ) {
    const weekly_slots = Array.from({ length: 7 }, (_, day_of_week) => ({
      day_of_week,
      start_time: '00:00',
      end_time: '23:45',
      slot_duration_minutes: 15,
      is_active: true,
    }));

    const data = await this.bookingsService.upsertDoctorAvailability(
      doctor._id,
      {
        timezone,
        weekly_slots,
      },
    );

    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/availability')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get doctor weekly availability',
    description:
      'Returns the current availability profile for the authenticated doctor.',
  })
  @ApiResponse({
    status: 200,
    description: 'Availability fetched successfully.',
    schema: { example: availabilityResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getDoctorAvailability(
    @CurrentUser() doctor: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorAvailability(doctor._id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/schedule')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get doctor schedule',
    description:
      "Returns the authenticated doctor's appointments and blackouts (both one-time and recurring) " +
      'within the specified date range. Recurring blackout rules are expanded into individual ' +
      'occurrences for each matching day in the range, ready for calendar rendering.',
  })
  @ApiQuery({
    name: 'weekly',
    required: false,
    description:
      'ISO week number (1-53). Returns schedule for that specific week with week metadata. Omit to fetch everything.',
    example: 15,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Year used with weekly. Defaults to current UTC year.',
    example: 2026,
  })
  @ApiResponse({
    status: 200,
    description: 'Schedule fetched successfully.',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: {
          appointments: [
            {
              _id: '67d5006d0dc8b8aa6d9f2001',
              appointment_number: 'APT-20260324-0001',
              patient_id: {
                _id: '67d4f2af0dc8b8aa6d9f0bbb',
                first_name: 'Ada',
                last_name: 'Okafor',
                full_name: 'Ada Okafor',
                email: 'patient@example.com',
              },
              scheduled_start_at_utc: '2026-03-24T09:00:00.000Z',
              scheduled_end_at_utc: '2026-03-24T09:30:00.000Z',
              status: 'PENDING',
              consultation_id: {
                _id: '67d5106d0dc8b8aa6d9f2abc',
                consultation_id: 'BOOK-X8F2K9LQ',
                type: 'VIDEO',
                title: 'Consultation from booking',
                status: 'PENDING',
              },
              reason_for_visit: 'Persistent headache',
            },
          ],
          blackouts: [
            {
              _id: '67d4f6b90dc8b8aa6d9f1555',
              start_at_utc: '2026-03-24T08:00:00.000Z',
              end_at_utc: '2026-03-24T09:00:00.000Z',
              reason: 'Morning prep',
              reccuring: true,
              recurring_rule_id: '67d4f6b90dc8b8aa6d9f1555',
            },
            {
              _id: '67d4f6b90dc8b8aa6d9f1666',
              start_at_utc: '2026-03-26T13:00:00.000Z',
              end_at_utc: '2026-03-26T17:00:00.000Z',
              reason: 'Conference',
              reccuring: false,
            },
          ],
        },
        request_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        path: '/api/v1/booking/doctors/me/schedule?from=2026-03-24T00:00:00.000Z&to=2026-03-30T23:59:59.999Z',
        timestamp: '2026-03-24T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing date range.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — doctor role required.',
  })
  async getDoctorSchedule(
    @CurrentUser() doctor: any,
    @Query() query: DoctorScheduleQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorSchedule(
      doctor._id,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/blackouts')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get doctor blackout periods',
    description:
      'Returns all blackout periods (one-time and recurring) for the authenticated doctor.',
  })
  @ApiResponse({ status: 200, description: 'Blackouts fetched successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — doctor role required.',
  })
  async getDoctorBlackouts(
    @CurrentUser() doctor: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorBlackouts(doctor._id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/patients')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all patients for the authenticated doctor',
    description:
      'Returns all unique patients who have had appointments with the authenticated doctor (excluding cancelled). ' +
      'Each entry includes the patient profile, their most recent appointment details, and total appointment count. ' +
      'Sorted by most recent appointment date.',
  })
  @ApiResponse({
    status: 200,
    description: 'Assigned patients fetched successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — doctor role required.',
  })
  async getDoctorPatients(
    @CurrentUser() doctor: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorPatients(doctor._id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Post('doctors/me/blackouts')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create doctor blackout periods',
    description:
      'Creates one or more unavailable time windows for the authenticated doctor. ' +
      'Each entry is validated individually — start_local must be before end_local in the provided timezone, ' +
      'and no entry may overlap an existing blackout. All entries are rejected if any validation fails.',
  })
  @ApiBody({
    type: CreateDoctorBlackoutsDto,
    description: 'Array of blackout periods to create.',
    examples: {
      single: {
        summary: 'Single blackout',
        value: {
          blackouts: [
            {
              start_local: '2026-03-25T08:00:00',
              end_local: '2026-03-25T17:00:00',
              timezone: 'Africa/Lagos',
              reason: 'Conference',
              reccuring: true,
            },
          ],
        },
      },
      multiple: {
        summary: 'Multiple blackouts',
        value: {
          blackouts: [
            {
              start_local: '2026-03-25T08:00:00',
              end_local: '2026-03-25T17:00:00',
              timezone: 'Africa/Lagos',
              reason: 'Conference',
              reccuring: true,
            },
            {
              start_local: '2026-03-26T08:00:00',
              end_local: '2026-03-26T12:00:00',
              timezone: 'Africa/Lagos',
              reccuring: false,
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Blackout periods created successfully.',
    schema: { example: blackoutCreateResponseExample },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid blackout time range — start_local is not before end_local.',
  })
  @ApiResponse({
    status: 409,
    description:
      'One or more blackout entries overlap an existing blackout period.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — doctor role required.',
  })
  async createDoctorBlackout(
    @CurrentUser() doctor: any,
    @Body() dto: CreateDoctorBlackoutsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.createDoctorBlackout(
      doctor._id,
      dto,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Delete('doctors/me/blackouts/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete doctor blackout period',
    description: 'Deletes a blackout period owned by the authenticated doctor.',
  })
  @ApiParam({ name: 'id', description: 'Blackout id' })
  @ApiResponse({
    status: 200,
    description: 'Blackout removed successfully.',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: { message: 'Blackout removed' },
        request_id: '060f8147-bef4-4bc1-a16c-d9c4f5af7bad',
        path: '/api/v1/doctors/me/blackouts/67d4f6b90dc8b8aa6d9f1555',
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Blackout not found.' })
  async deleteDoctorBlackout(
    @CurrentUser() doctor: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.deleteDoctorBlackout(
      doctor._id,
      id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/appointments')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List doctor appointments',
    description:
      'Returns paginated appointments for the authenticated doctor. Supports filtering by status and date range.',
  })
  @ApiResponse({
    status: 200,
    description: 'Appointments fetched successfully.',
    schema: { example: doctorAppointmentsResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getDoctorAppointments(
    @CurrentUser() doctor: any,
    @Query() query: DoctorAppointmentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorAppointments(
      doctor._id,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/appointments/all')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all doctor appointments',
    description:
      'Returns all non-rescheduled appointments belonging to the authenticated doctor (without pagination). ' +
      'Each appointment includes linked consultation data when present and a rescheduled_history array containing older RESCHEDULED appointments with the same appointment number.',
  })
  @ApiResponse({
    status: 200,
    description: 'All doctor appointments fetched successfully.',
    schema: { example: allDoctorAppointmentsResponseExample },
  })
  async getAllDoctorAppointments(
    @CurrentUser() doctor: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getAllDoctorAppointments(
      doctor._id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/appointments/approved')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List approved appointments (doctor)',
    description:
      'Returns only approved appointments (CONFIRMED) for the authenticated doctor. Supports optional weekly grouping via weekly and year query params.',
  })
  @ApiResponse({
    status: 200,
    description: 'Approved appointments fetched successfully.',
    schema: { example: doctorApprovedAppointmentsWeeklyResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getDoctorApprovedAppointments(
    @CurrentUser() doctor: any,
    @Query() query: DoctorApprovedAppointmentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorApprovedAppointments(
      doctor._id,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/appointments/number/:appointmentNumber')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get doctor appointments by appointment number',
    description:
      'Returns appointments with the given appointment number that belong to the authenticated doctor. ' +
      'A rescheduled appointment can share the same appointment number, so this endpoint returns a list.',
  })
  @ApiParam({ name: 'appointmentNumber', description: 'Appointment number' })
  @ApiResponse({
    status: 200,
    description: 'Appointments fetched successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async getDoctorAppointmentsByNumber(
    @CurrentUser() doctor: any,
    @Param('appointmentNumber') appointmentNumber: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorAppointmentsByNumber(
      doctor._id,
      appointmentNumber,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('doctors/me/appointments/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get doctor appointment details',
    description:
      'Returns a single appointment that belongs to the authenticated doctor, including linked consultation and rescheduled_history.',
  })
  @ApiParam({ name: 'id', description: 'Appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment details fetched successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async getDoctorAppointmentById(
    @CurrentUser() doctor: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.getDoctorAppointmentById(
      doctor._id,
      id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('doctors/me/appointments/:id/accept')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Accept appointment',
    description:
      'Doctor accepts an appointment by changing status to CONFIRMED if transition is valid.',
  })
  @ApiParam({ name: 'id', description: 'Appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment accepted.',
    schema: { example: statusTransitionResponseExample },
  })
  @ApiResponse({ status: 400, description: 'Invalid status transition.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async acceptAppointment(
    @CurrentUser() doctor: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.confirmAppointment(doctor._id, id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('appointments/:id/confirm')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm appointment',
    description:
      'Changes appointment status to CONFIRMED if current state transition is valid.',
  })
  @ApiParam({ name: 'id', description: 'Appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment confirmed.',
    schema: { example: statusTransitionResponseExample },
  })
  @ApiResponse({ status: 400, description: 'Invalid status transition.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async confirmAppointment(
    @CurrentUser() doctor: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.confirmAppointment(doctor._id, id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('appointments/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel appointment',
    description:
      'Changes appointment status to CANCELED if current state transition is valid.',
  })
  @ApiParam({ name: 'id', description: 'Appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment cancelled.',
    schema: {
      example: {
        ...statusTransitionResponseExample,
        data: {
          _id: '67d5006d0dc8b8aa6d9f2001',
          status: 'CANCELED',
          cancelled_by: 'doctor',
          cancelled_reason: 'Unavailable',
        },
        path: '/api/v1/booking/appointments/67d5006d0dc8b8aa6d9f2001/cancel',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid status transition.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async cancelAppointment(
    @CurrentUser() doctor: any,
    @Param('id') id: string,
    @Body() dto: DoctorAppointmentActionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.cancelAppointment(
      doctor._id,
      id,
      dto.reason,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('doctors/me/appointments/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel doctor appointment',
    description:
      'Doctor cancels one of their appointments by changing status to CANCELED if transition is valid.',
  })
  @ApiParam({ name: 'id', description: 'Appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment cancelled.',
    schema: {
      example: {
        ...statusTransitionResponseExample,
        data: {
          _id: '67d5006d0dc8b8aa6d9f2001',
          status: 'CANCELED',
          cancelled_by: 'doctor',
          cancelled_reason: 'Unavailable',
        },
        path: '/api/v1/booking/doctors/me/appointments/67d5006d0dc8b8aa6d9f2001/cancel',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid status transition.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  async cancelDoctorAppointment(
    @CurrentUser() doctor: any,
    @Param('id') id: string,
    @Body() dto: DoctorAppointmentActionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.cancelAppointment(
      doctor._id,
      id,
      dto.reason,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('doctors/me/appointments/:id/reschedule')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reschedule doctor appointment',
    description:
      'Creates a new appointment for a new slot and marks the current one as RESCHEDULED for audit purposes.',
  })
  @ApiBody({
    type: RescheduleAppointmentDto,
    schema: { example: rescheduleRequestExample },
  })
  @ApiParam({ name: 'id', description: 'Current appointment id' })
  @ApiResponse({
    status: 200,
    description: 'Appointment rescheduled successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid reschedule payload or state.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appointment not found.' })
  @ApiResponse({
    status: 409,
    description: 'Selected slot is no longer available.',
  })
  async rescheduleDoctorAppointment(
    @CurrentUser() doctor: any,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.bookingsService.rescheduleDoctorAppointment(
      doctor._id,
      id,
      dto,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }
}

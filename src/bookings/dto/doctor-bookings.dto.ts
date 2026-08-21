import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsBoolean,
    IsArray,
    IsDateString,
    IsEnum,
    IsInt,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { AppointmentFor, AppointmentStatus } from 'src/common/enums';
import { ConsultationTypeEnum } from 'src/consultations/consultations.enums';
import {
    IsUtcDateString,
    IsIanaTimezone,
    IsIsoLocalDateTime,
} from 'src/common/decorators';

export class WeeklySlotDto {
    @ApiProperty({
        example: 1,
        description: '0=Sunday … 6=Saturday, evaluated in the availability timezone.',
    })
    @IsInt()
    @Min(0)
    @Max(6)
    day_of_week: number;

    @ApiProperty({
        example: '09:00',
        description:
            'Local wall-clock start time (HH:mm, 24h) in the availability timezone.',
    })
    @IsString()
    @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    start_time: string;

    @ApiProperty({
        example: '13:00',
        description:
            'Local wall-clock end time (HH:mm, 24h) in the availability timezone.',
    })
    @IsString()
    @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
    end_time: string;

    @ApiProperty({ example: 30 })
    @IsInt()
    @Min(5)
    @Max(240)
    slot_duration_minutes: number;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    is_active?: boolean;
}

export class UpsertDoctorAvailabilityDto {
    @ApiProperty({
        example: 'Africa/Lagos',
        description:
            'IANA timezone in which weekly_slots times are expressed. Handles DST automatically.',
    })
    @IsIanaTimezone()
    timezone: string;

    @ApiProperty({ type: [WeeklySlotDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => WeeklySlotDto)
    weekly_slots: WeeklySlotDto[];

    @ApiPropertyOptional({ example: '2026-03-20' })
    @IsOptional()
    @IsDateString()
    effective_from?: string;

    @ApiPropertyOptional({ example: '2026-12-31' })
    @IsOptional()
    @IsDateString()
    effective_to?: string;
}

export class CreateDoctorBlackoutDto {
    @ApiProperty({
        example: '2026-03-25T08:00:00',
        description:
            'Local wall-clock start time (ISO 8601, no offset) in the provided timezone.',
    })
    @IsIsoLocalDateTime()
    start_local: string;

    @ApiProperty({
        example: '2026-03-25T17:00:00',
        description:
            'Local wall-clock end time (ISO 8601, no offset) in the provided timezone. Must be after start_local.',
    })
    @IsIsoLocalDateTime()
    end_local: string;

    @ApiProperty({
        example: 'Africa/Lagos',
        description: 'IANA timezone used to interpret start_local / end_local.',
    })
    @IsIanaTimezone()
    timezone: string;

    @ApiPropertyOptional({
        example: 'Conference',
        description: 'Optional reason for the blackout period.',
    })
    @IsOptional()
    @IsString()
    reason?: string;

    @ApiPropertyOptional({
        example: true,
        default: false,
        description: 'Whether this blackout recurs. Defaults to false.',
    })
    @IsOptional()
    @IsBoolean()
    reccuring?: boolean;
}

export class CreateDoctorBlackoutsDto {
    @ApiProperty({
        type: [CreateDoctorBlackoutDto],
        description: 'Array of blackout periods to create. At least one entry is required.',
        example: [
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
    })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateDoctorBlackoutDto)
    blackouts: CreateDoctorBlackoutDto[];
}

export class DoctorScheduleQueryDto {
    @ApiPropertyOptional({
        example: 15,
        description: 'ISO week number (1-53). When provided, returns schedule for that specific week with week metadata. Omit to fetch all appointments and blackouts.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(53)
    weekly?: number;

    @ApiPropertyOptional({
        example: 2026,
        description: 'Year used with the weekly param. Defaults to current UTC year.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1970)
    year?: number;
}

export class DoctorAppointmentsQueryDto {
    @ApiPropertyOptional({
        example: 'John',
        description: 'Search by appointment number, or patient first/last name.',
    })
    @IsOptional()
    @IsString()
    q?: string;

    @ApiPropertyOptional({ enum: AppointmentStatus })
    @IsOptional()
    @IsEnum(AppointmentStatus)
    status?: AppointmentStatus;

    @ApiPropertyOptional({ example: '2026-03-01T00:00:00.000Z' })
    @IsOptional()
    @IsUtcDateString()
    from?: string;

    @ApiPropertyOptional({ example: '2026-03-31T23:59:59.000Z' })
    @IsOptional()
    @IsUtcDateString()
    to?: string;

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ example: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    perPage?: number = 20;
}

export class DoctorApprovedAppointmentsQueryDto {
    @ApiPropertyOptional({
        example: 10,
        description: 'ISO week number (1-53). If provided, returns appointments for that week only.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(53)
    weekly?: number;

    @ApiPropertyOptional({
        example: 2026,
        description: 'Year used with weekly filter. Defaults to current UTC year.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1970)
    year?: number;
}

export class SystemAvailabilityQueryDto {
    @ApiPropertyOptional({
        example: '2026-06-08',
        description:
            'Start of the availability window (YYYY-MM-DD, inclusive). Used with endDate. If only startDate is supplied, endDate defaults to 13 days later.',
    })
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @ApiPropertyOptional({
        example: '2026-06-14',
        description: 'End of the availability window (YYYY-MM-DD, inclusive). Used with startDate.',
    })
    @IsOptional()
    @IsDateString()
    endDate?: string;

    @ApiPropertyOptional({
        example: '2026-06-08',
        description: 'Legacy alias for startDate (YYYY-MM-DD, inclusive).',
    })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({
        example: '2026-06-14',
        description: 'Legacy alias for endDate (YYYY-MM-DD, inclusive).',
    })
    @IsOptional()
    @IsDateString()
    to?: string;

    @ApiPropertyOptional({
        example: 7,
        description:
            'Alternative range mode. If provided, overrides explicit dates and returns the next N days starting today in UTC.',
        minimum: 1,
        maximum: 60,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(60)
    days_ahead?: number;

    @ApiPropertyOptional({
        example: 'America/Edmonton',
        description: 'IANA timezone used for the response calendar days and displayed slot times. Defaults to UTC.',
    })
    @IsOptional()
    @IsIanaTimezone()
    timezone?: string = 'UTC';
}

export class WeeklyAppointmentsQueryDto {
    @ApiPropertyOptional({
        example: 2026,
        description: 'Limit grouping to a single UTC year. Omit to include all years.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1970)
    year?: number;

    @ApiPropertyOptional({
        example: false,
        description: 'Include appointments already marked as RESCHEDULED.',
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    include_rescheduled?: boolean = false;
}

export class DoctorAppointmentActionDto {
    @ApiPropertyOptional({ example: 'Patient requested cancellation' })
    @IsOptional()
    @IsString()
    reason?: string;
}

export class AvailableDoctorsQueryDto {
    @ApiPropertyOptional({ example: 'dermatology' })
    @IsOptional()
    @IsString()
    q?: string;

    @ApiPropertyOptional({ example: 'Cardiology' })
    @IsOptional()
    @IsString()
    specialization?: string;

    @ApiPropertyOptional({ example: '2026-03-20' })
    @IsOptional()
    @IsDateString()
    date?: string;

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ example: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    perPage?: number = 20;
}

export class DoctorAvailabilitySlotsQueryDto {
    @ApiProperty({
        example: '2026-03-20',
        description: 'Local calendar date (YYYY-MM-DD) in the doctor availability timezone.',
    })
    @IsDateString()
    date: string;
}

export class CheckDoctorAvailabilityQueryDto {
    @ApiProperty({
        example: '2026-04-05T10:00:00',
        description:
            'Local wall-clock datetime (ISO 8601, no offset) expressed in the provided timezone.',
    })
    @IsIsoLocalDateTime()
    datetime_local: string;

    @ApiProperty({
        example: 'America/Edmonton',
        description: 'IANA timezone used to interpret datetime_local.',
    })
    @IsIanaTimezone()
    timezone: string;

    @ApiProperty({ example: 30, description: 'Requested duration in minutes.', enum: [15, 30, 45, 60] })
    @Type(() => Number)
    @IsInt()
    @IsIn([15, 30, 45, 60])
    duration: number;
}

export class FindOptimalDoctorQueryDto {
    @ApiProperty({
        example: '2026-04-05T10:00:00',
        description:
            'Local wall-clock datetime (ISO 8601, no offset) expressed in the provided timezone.',
    })
    @IsIsoLocalDateTime()
    datetime_local: string;

    @ApiProperty({
        example: 'America/Edmonton',
        description: 'IANA timezone used to interpret datetime_local.',
    })
    @IsIanaTimezone()
    timezone: string;

    @ApiProperty({ example: 30, description: 'Requested duration in minutes.', enum: [15, 30, 45, 60] })
    @Type(() => Number)
    @IsInt()
    @IsIn([15, 30, 45, 60])
    duration: number;

    @ApiPropertyOptional({ example: 'Cardiology', description: 'Preferred specialization. Matched doctors are prioritized.' })
    @IsOptional()
    @IsString()
    specialization?: string;
}

export class CreatePatientAppointmentDto {
    @ApiProperty({ example: 'Ada' })
    @IsString()
    @IsNotEmpty()
    first_name: string;

    @ApiProperty({ example: 'Ifeanyi' })
    @IsString()
    @IsNotEmpty()
    last_name: string;

    @ApiPropertyOptional({ example: '1994-05-11' })
    @IsOptional()
    @IsDateString()
    date_of_birth?: string;

    @ApiPropertyOptional({ example: 'female' })
    @IsOptional()
    @IsString()
    gender?: string;

    @ApiPropertyOptional({ example: 'single' })
    @IsOptional()
    @IsString()
    marital_status?: string;

    @ApiPropertyOptional({ example: 'Engineer' })
    @IsOptional()
    @IsString()
    occupation?: string;

    @ApiProperty({ example: 'Persistent headache for 3 days' })
    @IsString()
    @IsNotEmpty()
    present_complaint: string;

    @ApiPropertyOptional({
        example: '67d4f0be0dc8b8aa6d9f0aaa',
        description: 'Required when BOOKING_MODE=manual. Ignored in auto-match mode.',
    })
    @IsOptional()
    @IsString()
    doctor_id?: string;

    @ApiPropertyOptional({
        example: 'Cardiology',
        description: 'Preferred specialization for auto-match mode. Ignored in manual mode.',
    })
    @IsOptional()
    @IsString()
    specialization?: string;

    @ApiProperty({
        example: '2026-04-16T10:00:00',
        description:
            'Local wall-clock datetime (ISO 8601, no offset) in the patient timezone.',
    })
    @IsIsoLocalDateTime()
    scheduled_start_local: string;

    @ApiProperty({
        example: 'America/Edmonton',
        description: 'IANA timezone used to interpret scheduled_start_local.',
    })
    @IsIanaTimezone()
    timezone: string;

    @ApiProperty({
        example: 30,
        description: 'Requested appointment duration in minutes',
        enum: [15, 30, 45, 60],
    })
    @Type(() => Number)
    @IsInt()
    @IsIn([15, 30, 45, 60])
    requested_duration_minutes: number;

    @ApiPropertyOptional({ example: 'Mild chest discomfort for 2 days' })
    @IsOptional()
    @IsString()
    reason_for_visit?: string;

    @ApiPropertyOptional({ example: 'Intermittent headache with mild dizziness' })
    @IsOptional()
    @IsString()
    complaint_brief?: string;

    @ApiPropertyOptional({
        type: [String],
        example: ['Hypertension', 'Asthma'],
        description:
            'Conditions declared for this booking. Snapshotted onto the appointment. ' +
            'When appointment_for is SELF these are also merged into the patient ' +
            'profile — added, never removed, matched case-insensitively — so sending a ' +
            'short or empty list here cannot clear what is already on file. Use ' +
            'PATCH /patients/me/profile to remove an entry.',
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    Medical_conditions?: string[];

    @ApiPropertyOptional({
        type: [String],
        example: ['Penicillin', 'Peanuts'],
        description:
            'Allergies declared for this booking. Snapshotted onto the appointment and ' +
            'used to prefill the doctor\'s history-taking form. Merged into the patient ' +
            'profile on the same additive terms as Medical_conditions.',
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    allergies?: string[];

    @ApiPropertyOptional({
        enum: ConsultationTypeEnum,
        example: ConsultationTypeEnum.VIDEO,
        description: 'Type of consultation. Defaults to VIDEO if not provided.',
        default: ConsultationTypeEnum.VIDEO,
    })
    @IsOptional()
    @IsEnum(ConsultationTypeEnum)
    consultation_type?: ConsultationTypeEnum;

    @ApiProperty({
        example: true,
        description: 'Final client confirmation that submits this booking request',
    })
    @IsBoolean()
    confirm_appointment: boolean;

    @ApiPropertyOptional({
        enum: AppointmentFor,
        example: AppointmentFor.SELF,
        description:
            'Whether the appointment is for the logged-in patient (SELF) or someone else (OTHERS). ' +
            'When SELF, booking details reconcile to the patient profile.',
        default: AppointmentFor.SELF,
    })
    @IsOptional()
    @IsEnum(AppointmentFor)
    appointment_for?: AppointmentFor;
}

export class PatientAppointmentsQueryDto {
    @ApiPropertyOptional({
        example: 'Dr. Smith',
        description: 'Search by appointment number, or doctor first/last name.',
    })
    @IsOptional()
    @IsString()
    q?: string;

    @ApiPropertyOptional({ enum: AppointmentStatus })
    @IsOptional()
    @IsEnum(AppointmentStatus)
    status?: AppointmentStatus;

    @ApiPropertyOptional({ example: '2026-03-01T00:00:00.000Z' })
    @IsOptional()
    @IsUtcDateString()
    from?: string;

    @ApiPropertyOptional({ example: '2026-03-31T23:59:59.000Z' })
    @IsOptional()
    @IsUtcDateString()
    to?: string;

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ example: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    perPage?: number = 20;
}

export class PatientCancelAppointmentDto {
    @ApiPropertyOptional({ example: 'I am unavailable at that time' })
    @IsOptional()
    @IsString()
    reason?: string;
}

export class RescheduleAppointmentDto {
    @ApiProperty({
        example: '2026-03-26T10:00:00',
        description:
            'Local wall-clock datetime (ISO 8601, no offset) in the requester timezone.',
    })
    @IsIsoLocalDateTime()
    scheduled_start_local: string;

    @ApiProperty({
        example: 'America/Edmonton',
        description: 'IANA timezone used to interpret scheduled_start_local.',
    })
    @IsIanaTimezone()
    timezone: string;

    @ApiProperty({
        example: 30,
        description: 'Requested new appointment duration in minutes',
        enum: [15, 30, 45, 60],
    })
    @Type(() => Number)
    @IsInt()
    @IsIn([15, 30, 45, 60])
    requested_duration_minutes: number;

    @ApiPropertyOptional({
        example: 'Cardiology',
        description: 'Original requested specialization used for fallback doctor prioritization.',
    })
    @IsOptional()
    @IsString()
    requested_specialization?: string;

    @ApiPropertyOptional({ example: 'Need a different time due to schedule conflict' })
    @IsOptional()
    @IsString()
    reason?: string;
}

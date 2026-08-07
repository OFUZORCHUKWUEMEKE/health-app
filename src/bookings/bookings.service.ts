import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Types } from 'mongoose';
import { Model } from 'mongoose';
import { AppointmentFor, AppointmentStatus, Role } from 'src/common/enums';
import {
    Consultation,
    ConsultationDocument,
} from 'src/consultations/consultations.model';
import {
    ConsultationForEnum,
    ConsultationStatusEnum,
    ConsultationTypeEnum,
} from 'src/consultations/consultations.enums';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { UserRepository } from 'src/users/user.repository';
import {
    AvailableDoctorsQueryDto,
    CreatePatientAppointmentDto,
    CreateDoctorBlackoutsDto,
    DoctorScheduleQueryDto,
    DoctorApprovedAppointmentsQueryDto,
    DoctorAvailabilitySlotsQueryDto,
    DoctorAppointmentsQueryDto,
    PatientAppointmentsQueryDto,
    PatientCancelAppointmentDto,
    RescheduleAppointmentDto,
    UpsertDoctorAvailabilityDto,
    WeeklySlotDto,
    WeeklyAppointmentsQueryDto,
    SystemAvailabilityQueryDto,
} from './dto/doctor-bookings.dto';
import { AppointmentsRepository } from './appointments.repository';
import { DoctorAvailabilityRepository } from './doctor-availability.repository';
import { DoctorBlackoutRepository } from './doctor-blackout.repository';
import { AppointmentDocument } from './models/appointment.model';
import {
    localToUtc,
    zonedClock,
    startOfZonedDayUtc,
    endOfZonedDayUtc,
    zonedDateAndTimeToUtc,
    zonedIsoDate,
} from 'src/common/utils/timezone.util';
import { DateTime } from 'luxon';

const DEFAULT_ZONE = 'UTC';
const AVAILABILITY_MATRIX_SLOT_MINUTES = 15;
const MAX_BOOKABLE_CONSECUTIVE_SLOTS = 60 / AVAILABILITY_MATRIX_SLOT_MINUTES;

@Injectable()
export class BookingsService implements OnModuleInit {
    private readonly logger = new Logger(BookingsService.name);

    constructor(
        private readonly doctorAvailabilityRepository: DoctorAvailabilityRepository,
        private readonly doctorBlackoutRepository: DoctorBlackoutRepository,
        private readonly appointmentsRepository: AppointmentsRepository,
        private readonly doctorRepository: DoctorRepository,
        @InjectModel(Consultation.name)
        private readonly consultationModel: Model<ConsultationDocument>,
        private readonly configService: ConfigService,
        private readonly userRepository: UserRepository,
    ) { }

    async onModuleInit() {
        try {
            const model = this.appointmentsRepository.model();
            const indexes = await model.collection.indexes();
            const uniqueApptNumberIndex = indexes.find((idx) =>
                idx?.key && idx.key.appointment_number === 1 && idx.unique,
            );

            if (uniqueApptNumberIndex?.name) {
                await model.collection.dropIndex(uniqueApptNumberIndex.name);
                this.logger.log(
                    `Dropped unique index on appointment_number: ${uniqueApptNumberIndex.name}`,
                );
            }
        } catch (error) {
            this.logger.warn(`Index check failed: ${error?.message || error}`);
        }
    }

    async listAvailableDoctors(query: AvailableDoctorsQueryDto) {
        const page = query.page || 1;
        const perPage = query.perPage || 20;
        const skip = (page - 1) * perPage;

        const availabilityFilter: any = {
            'weekly_slots.is_active': true,
        };

        if (query.date) {
            const targetDate = new Date(query.date);
            if (Number.isNaN(targetDate.getTime())) {
                throw new BadRequestException('Invalid date filter');
            }

            availabilityFilter.$and = [
                {
                    $or: [
                        { effective_from: { $exists: false } },
                        { effective_from: null },
                        { effective_from: { $lte: targetDate } },
                    ],
                },
                {
                    $or: [
                        { effective_to: { $exists: false } },
                        { effective_to: null },
                        { effective_to: { $gte: targetDate } },
                    ],
                },
            ];
        }

        const availabilities = await this.doctorAvailabilityRepository
            .model()
            .find(availabilityFilter, {
                doctor_id: 1,
                timezone: 1,
                weekly_slots: 1,
                effective_from: 1,
                effective_to: 1,
            })
            .lean();

        const doctorIds = availabilities.map((a) => a.doctor_id);

        if (!doctorIds.length) {
            return [];
        }

        const doctorFilter: any = {
            _id: { $in: doctorIds },
            active: true,
        };

        if (query.specialization?.trim()) {
            doctorFilter.specializations = {
                $in: [new RegExp(query.specialization.trim(), 'i')],
            };
        }

        if (query.q?.trim()) {
            const keyword = new RegExp(query.q.trim(), 'i');
            doctorFilter.$or = [
                { full_name: keyword },
                { first_name: keyword },
                { last_name: keyword },
                { specializations: { $elemMatch: { $regex: keyword } } },
            ];
        }

        const doctors = await this.doctorRepository.model().find(doctorFilter, {
            first_name: 1,
            last_name: 1,
            full_name: 1,
            email: 1,
            profile_picture_url: 1,
            specializations: 1,
            active: 1,
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(perPage)
            .lean();

        const availabilityMap = new Map(
            availabilities.map((a: any) => [String(a.doctor_id), a]),
        );

        const items = doctors.map((doctor: any) => {
            const availability = availabilityMap.get(String(doctor._id));
            return {
                ...doctor,
                availability: availability
                    ? {
                        timezone: availability.timezone,
                        weekly_slots: availability.weekly_slots,
                        effective_from: availability.effective_from || null,
                        effective_to: availability.effective_to || null,
                    }
                    : null,
            };
        });

        return items;
    }

    async getDoctorAvailableSlots(doctorId: string, query: DoctorAvailabilitySlotsQueryDto) {
        if (!Types.ObjectId.isValid(doctorId)) {
            throw new BadRequestException('Invalid doctor id');
        }

        const doctorObjectId = new Types.ObjectId(doctorId);
        const doctor = await this.doctorRepository.findOne({
            _id: doctorObjectId,
            active: true,
        });

        if (!doctor) {
            throw new NotFoundException('Doctor not found');
        }

        const availability = await this.doctorAvailabilityRepository.findOne({
            doctor_id: doctorObjectId,
        });

        if (!availability) {
            return { doctor_id: doctorId, date: query.date, timezone: null, slots: [] };
        }

        this.assertIsoDateOnly(query.date);
        const zone = availability.timezone || DEFAULT_ZONE;
        const dayStart = this.dayStartUtc(query.date, zone);
        const dayEnd = this.dayEndUtc(query.date, zone);
        const dayOfWeek = zonedClock(dayStart, zone).dayOfWeek;

        if (
            !this.isWithinEffectiveRange(
                dayStart,
                availability.effective_from,
                availability.effective_to,
                zone,
            )
        ) {
            return {
                doctor_id: doctorId,
                date: query.date,
                timezone: zone,
                slots: [],
            };
        }

        const daySlots = (availability.weekly_slots || []).filter(
            (slot: WeeklySlotDto) => slot.is_active !== false && slot.day_of_week === dayOfWeek,
        );

        if (!daySlots.length) {
            return {
                doctor_id: doctorId,
                date: query.date,
                timezone: zone,
                slots: [],
            };
        }

        const [blackouts, recurringBlackouts, appointments] = await Promise.all([
            this.doctorBlackoutRepository
                .model()
                .find({
                    doctor_id: doctorObjectId,
                    reccuring: { $ne: true },
                    start_at_utc: { $lt: dayEnd },
                    end_at_utc: { $gt: dayStart },
                })
                .lean(),
            this.doctorBlackoutRepository
                .model()
                .find({
                    doctor_id: doctorObjectId,
                    reccuring: true,
                })
                .lean(),
            this.appointmentsRepository
                .model()
                .find({
                    doctor_id: doctorObjectId,
                    scheduled_start_at_utc: { $gte: dayStart, $lt: dayEnd },
                    status: {
                        $in: [
                            AppointmentStatus.PENDING,
                            AppointmentStatus.CONFIRMED,
                        ],
                    },
                })
                .lean(),
        ]);

        const slots = this.buildSlotsForDate(query.date, daySlots, zone)
            .filter((slot) => !this.overlapsAny(slot.start, slot.end, blackouts, 'start_at_utc', 'end_at_utc'))
            .filter((slot) => !this.overlapsRecurring(slot.start, slot.end, recurringBlackouts, zone))
            .filter(
                (slot) =>
                    !this.overlapsAny(
                        slot.start,
                        slot.end,
                        appointments,
                        'scheduled_start_at_utc',
                        'scheduled_end_at_utc',
                    ),
            )
            .map((slot) => ({
                start_at_utc: slot.start.toISOString(),
                end_at_utc: slot.end.toISOString(),
            }));

        return {
            doctor_id: doctorId,
            date: query.date,
            timezone: zone,
            slots,
        };
    }

    async checkDoctorAvailability(
        doctorId: string,
        datetimeLocal: string,
        timezone: string,
        duration: number,
    ) {
        if (!Types.ObjectId.isValid(doctorId)) {
            throw new BadRequestException('Invalid doctor id');
        }

        const doctorObjectId = new Types.ObjectId(doctorId);
        const doctor = await this.doctorRepository.findOne({ _id: doctorObjectId, active: true });

        if (!doctor) {
            throw new NotFoundException('Doctor not found');
        }

        const start = localToUtc(datetimeLocal, timezone);
        const end = new Date(start.getTime() + duration * 60 * 1000);

        const availability = await this.doctorAvailabilityRepository.findOne({ doctor_id: doctorObjectId });
        if (!availability) {
            return { available: false, reason: 'Doctor has no configured availability' };
        }

        const zone = availability.timezone || DEFAULT_ZONE;

        if (
            !this.isWithinEffectiveRange(
                start,
                availability.effective_from,
                availability.effective_to,
                zone,
            )
        ) {
            return { available: false, reason: 'Outside doctor availability date range' };
        }

        const matchedSlot = this.findMatchingWeeklySlot(
            availability.weekly_slots || [],
            start,
            zone,
        );
        if (!matchedSlot) {
            return { available: false, reason: 'Doctor does not have a slot at this day/time' };
        }

        if (duration % matchedSlot.slot_duration_minutes !== 0) {
            return { available: false, reason: 'Duration does not align with slot interval' };
        }

        if (
            !this.isRangeWithinAvailabilityWindow(
                availability.weekly_slots || [],
                start,
                end,
                zone,
            )
        ) {
            return { available: false, reason: 'Duration exceeds available time window' };
        }

        const [overlapBlackout, recurringBlackouts, overlapAppointment] = await Promise.all([
            this.doctorBlackoutRepository.findOne({
                doctor_id: doctorObjectId,
                reccuring: { $ne: true },
                start_at_utc: { $lt: end },
                end_at_utc: { $gt: start },
            }),
            this.doctorBlackoutRepository.model().find({
                doctor_id: doctorObjectId,
                reccuring: true,
            }).lean(),
            this.appointmentsRepository.findOne({
                doctor_id: doctorObjectId,
                status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
                scheduled_start_at_utc: { $lt: end },
                scheduled_end_at_utc: { $gt: start },
            }),
        ]);

        const overlapRecurring = this.overlapsRecurring(start, end, recurringBlackouts, zone);

        if (overlapBlackout || overlapRecurring) {
            return { available: false, reason: 'Blocked by a blackout period' };
        }

        if (overlapAppointment) {
            return { available: false, reason: 'Slot is already booked' };
        }

        return {
            available: true,
            doctor: {
                _id: doctor._id,
                first_name: (doctor as any).first_name,
                last_name: (doctor as any).last_name,
                full_name: (doctor as any).full_name,
                specializations: (doctor as any).specializations,
            },
            slot: {
                start_at_utc: start.toISOString(),
                end_at_utc: end.toISOString(),
                duration_minutes: duration,
                timezone: zone,
            },
        };
    }

    async findOptimalDoctor(
        datetimeLocal: string,
        timezone: string,
        duration: number,
        specialization?: string,
    ) {
        const start = localToUtc(datetimeLocal, timezone);
        const end = new Date(start.getTime() + duration * 60 * 1000);

        // 1. Fetch ALL availabilities with at least one active slot — filtering by
        //    UTC day-of-week is wrong here since each availability lives in its own zone.
        const availabilities = await this.doctorAvailabilityRepository
            .model()
            .find({
                weekly_slots: {
                    $elemMatch: { is_active: { $ne: false } },
                },
            })
            .lean();

        if (!availabilities.length) {
            return { found: false, reason: 'No doctors are available on the selected day' };
        }

        // 2. Filter to those where the requested instant fits a slot in their own zone.
        const validAvailabilities = availabilities.filter((avail: any) => {
            const zone = avail.timezone || DEFAULT_ZONE;
            if (!this.isWithinEffectiveRange(start, avail.effective_from, avail.effective_to, zone)) return false;
            const matchedSlot = this.findMatchingWeeklySlot(avail.weekly_slots || [], start, zone);
            if (!matchedSlot) return false;
            if (duration % matchedSlot.slot_duration_minutes !== 0) return false;
            return this.isRangeWithinAvailabilityWindow(avail.weekly_slots || [], start, end, zone);
        });

        if (!validAvailabilities.length) {
            return { found: false, reason: 'No doctors have availability for the requested time slot' };
        }

        const candidateDoctorIds = validAvailabilities.map((a: any) => a.doctor_id);

        // 3. Fetch active doctors
        const allDoctors: any[] = await this.doctorRepository
            .model()
            .find(
                { _id: { $in: candidateDoctorIds }, active: true },
                { _id: 1, first_name: 1, last_name: 1, full_name: 1, email: 1, specializations: 1, profile_picture_url: 1 },
            )
            .lean();

        if (!allDoctors.length) {
            return { found: false, reason: 'No active doctors available for the requested time' };
        }

        // 4. Sort: specialization match first
        const specPref = specialization?.trim().toLowerCase();
        const sortedDoctors = specPref
            ? [
                ...allDoctors.filter((d: any) =>
                    (d.specializations || []).some((s: string) => s.toLowerCase() === specPref),
                ),
                ...allDoctors.filter((d: any) =>
                    !(d.specializations || []).some((s: string) => s.toLowerCase() === specPref),
                ),
            ]
            : allDoctors;

        const sortedDoctorIds = sortedDoctors.map((d: any) => d._id);

        // 5. Bulk-fetch conflicts. Recurring blackouts are evaluated per-zone in-memory.
        const [oneTimeBlackouts, recurringBlackouts, existingAppointments] = await Promise.all([
            this.doctorBlackoutRepository.model().find({
                doctor_id: { $in: sortedDoctorIds },
                reccuring: { $ne: true },
                start_at_utc: { $lt: end },
                end_at_utc: { $gt: start },
            }).lean(),
            this.doctorBlackoutRepository.model().find({
                doctor_id: { $in: sortedDoctorIds },
                reccuring: true,
            }).lean(),
            this.appointmentsRepository.model().find({
                doctor_id: { $in: sortedDoctorIds },
                status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
                scheduled_start_at_utc: { $lt: end },
                scheduled_end_at_utc: { $gt: start },
            }).lean(),
        ]);

        const groupByDoctor = <T extends { doctor_id: any }>(items: T[]) => {
            const map = new Map<string, T[]>();
            for (const item of items) {
                const key = String(item.doctor_id);
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(item);
            }
            return map;
        };

        const oneTimeMap = groupByDoctor(oneTimeBlackouts as any[]);
        const recurringMap = groupByDoctor(recurringBlackouts as any[]);
        const appointmentMap = groupByDoctor(existingAppointments as any[]);

        const availabilityMap = new Map(
            validAvailabilities.map((a: any) => [String(a.doctor_id), a]),
        );

        // 6. First doctor with no conflicts wins
        for (const doctor of sortedDoctors) {
            const docId = String(doctor._id);
            const avail = availabilityMap.get(docId) as any;
            const zone = avail?.timezone || DEFAULT_ZONE;

            const docOneTime = oneTimeMap.get(docId) || [];
            if (this.overlapsAny(start, end, docOneTime, 'start_at_utc', 'end_at_utc')) continue;

            const docRecurring = recurringMap.get(docId) || [];
            if (this.overlapsRecurring(start, end, docRecurring, zone)) continue;

            const docAppointments = appointmentMap.get(docId) || [];
            if (this.overlapsAny(start, end, docAppointments, 'scheduled_start_at_utc', 'scheduled_end_at_utc')) continue;

            return {
                found: true,
                doctor: {
                    _id: doctor._id,
                    first_name: doctor.first_name,
                    last_name: doctor.last_name,
                    full_name: doctor.full_name,
                    email: doctor.email,
                    specializations: doctor.specializations,
                    profile_picture_url: doctor.profile_picture_url,
                },
                slot: {
                    start_at_utc: start.toISOString(),
                    end_at_utc: end.toISOString(),
                    duration_minutes: duration,
                    timezone: zone,
                },
            };
        }

        return { found: false, reason: 'No available doctor found for the requested time slot' };
    }

    async createPatientAppointment(patientId: string, dto: CreatePatientAppointmentDto) {
        if (!dto.confirm_appointment) {
            throw new BadRequestException('Please confirm appointment to continue');
        }

        const start = localToUtc(dto.scheduled_start_local, dto.timezone);

        if (start.getTime() < Date.now()) {
            throw new BadRequestException('Cannot book a past timeslot');
        }

        const mode = this.configService.get<string>('BOOKING_MODE', 'auto');

        if (mode === 'manual') {
            return this.createManualAppointment(patientId, dto, start);
        }

        return this.createAutoMatchAppointment(patientId, dto, start);
    }

    async createPatientAppointmentWithFallback(patientId: string, dto: CreatePatientAppointmentDto) {
        if (!dto.confirm_appointment) {
            throw new BadRequestException('Please confirm appointment to continue');
        }

        const start = localToUtc(dto.scheduled_start_local, dto.timezone);

        if (start.getTime() < Date.now()) {
            throw new BadRequestException('Cannot book a past timeslot');
        }

        let fallbackReason: string | null = null;

        // 1) Try requested doctor first (if provided)
        if (dto.doctor_id && Types.ObjectId.isValid(dto.doctor_id)) {
            const availabilityCheck = await this.checkDoctorAvailability(
                dto.doctor_id,
                dto.scheduled_start_local,
                dto.timezone,
                dto.requested_duration_minutes,
            );

            if (availabilityCheck.available) {
                try {
                    const appointment = await this.createManualAppointment(patientId, dto, start);
                    return {
                        booked: true,
                        fallback_used: false,
                        selected_doctor_id: dto.doctor_id,
                        appointment,
                    };
                } catch (error: any) {
                    if (error instanceof ConflictException) {
                        fallbackReason = 'Requested doctor became unavailable while booking';
                    } else {
                        throw error;
                    }
                }
            } else {
                fallbackReason = availabilityCheck.reason || 'Requested doctor is unavailable';
            }
        }

        // 2) Fallback: pick next best doctor for this time
        const optimal = await this.findOptimalDoctor(
            dto.scheduled_start_local,
            dto.timezone,
            dto.requested_duration_minutes,
            dto.specialization,
        );

        if (!optimal?.found || !optimal?.doctor?._id) {
            throw new BadRequestException(
                fallbackReason || optimal?.reason || 'No available doctor found for the requested time slot',
            );
        }

        const fallbackDto: CreatePatientAppointmentDto = {
            ...dto,
            doctor_id: String(optimal.doctor._id),
        };

        let appointment: any;
        try {
            appointment = await this.createManualAppointment(patientId, fallbackDto, start);
        } catch (error: any) {
            if (error instanceof ConflictException) {
                // Last-mile fallback for race conditions
                appointment = await this.createAutoMatchAppointment(patientId, dto, start);
            } else {
                throw error;
            }
        }

        return {
            booked: true,
            fallback_used: true,
            fallback_reason: fallbackReason,
            selected_doctor: optimal.doctor,
            appointment,
        };
    }

    private async createManualAppointment(
        patientId: string,
        dto: CreatePatientAppointmentDto,
        start: Date,
    ) {
        if (!dto.doctor_id || !Types.ObjectId.isValid(dto.doctor_id)) {
            throw new BadRequestException('doctor_id is required in manual booking mode');
        }

        const doctorObjectId = new Types.ObjectId(dto.doctor_id);
        const doctor = await this.doctorRepository.findOne({
            _id: doctorObjectId,
            active: true,
        });

        if (!doctor) {
            throw new NotFoundException('Doctor not found');
        }

        const availability = await this.doctorAvailabilityRepository.findOne({
            doctor_id: doctorObjectId,
        });

        if (!availability) {
            throw new BadRequestException('Doctor has no configured availability');
        }

        const zone = availability.timezone || DEFAULT_ZONE;
        const end = new Date(start.getTime() + dto.requested_duration_minutes * 60 * 1000);

        await this.assertPatientNotDoubleBooked(
            new Types.ObjectId(patientId),
            start,
            end,
        );
        this.validateSlotForDoctor(availability, start, end, dto.requested_duration_minutes, zone);
        await this.assertNoConflicts(doctorObjectId, start, end, zone);

        return this.persistAppointmentAndConsultation(patientId, doctorObjectId, zone, start, end, dto);
    }

    private async createAutoMatchAppointment(
        patientId: string,
        dto: CreatePatientAppointmentDto,
        start: Date,
    ) {
        const end = new Date(start.getTime() + dto.requested_duration_minutes * 60 * 1000);

        // 1. Fetch all availabilities with an active slot — day-of-week is per-zone,
        //    so we can't safely pre-filter by it in the DB layer.
        const availabilities = await this.doctorAvailabilityRepository
            .model()
            .find({
                weekly_slots: {
                    $elemMatch: { is_active: { $ne: false } },
                },
            })
            .lean();

        if (!availabilities.length) {
            throw new BadRequestException('No doctors are available on the selected day');
        }

        // 2. Filter availabilities where the requested instant fits in their own zone.
        const validAvailabilities = availabilities.filter((avail: any) => {
            const zone = avail.timezone || DEFAULT_ZONE;
            if (!this.isWithinEffectiveRange(start, avail.effective_from, avail.effective_to, zone)) {
                return false;
            }
            const matchedSlot = this.findMatchingWeeklySlot(avail.weekly_slots || [], start, zone);
            if (!matchedSlot) return false;
            if (dto.requested_duration_minutes % matchedSlot.slot_duration_minutes !== 0) return false;
            return this.isRangeWithinAvailabilityWindow(avail.weekly_slots || [], start, end, zone);
        });

        if (!validAvailabilities.length) {
            throw new BadRequestException('No doctors have availability for the requested time slot');
        }

        const candidateDoctorIds = validAvailabilities.map((a: any) => a.doctor_id);

        // 3. Fetch active doctors (prefer specialization match, then fallback)
        const doctorFilter: any = {
            _id: { $in: candidateDoctorIds },
            active: true,
        };

        const allDoctors: any[] = await this.doctorRepository
            .model()
            .find(doctorFilter, { _id: 1, specializations: 1 })
            .lean();

        if (!allDoctors.length) {
            throw new BadRequestException('No active doctors available for the requested time');
        }

        const specPref = dto.specialization?.trim().toLowerCase();
        const sortedDoctors = specPref
            ? [
                ...allDoctors.filter((d: any) =>
                    (d.specializations || []).some((s: string) => s.toLowerCase() === specPref),
                ),
                ...allDoctors.filter((d: any) =>
                    !(d.specializations || []).some((s: string) => s.toLowerCase() === specPref),
                ),
            ]
            : allDoctors;

        const sortedDoctorIds = sortedDoctors.map((d: any) => d._id);

        // 4. Bulk-fetch conflicts. Recurring blackouts evaluated per-zone in-memory.
        const [oneTimeBlackouts, recurringBlackouts, existingAppointments] = await Promise.all([
            this.doctorBlackoutRepository
                .model()
                .find({
                    doctor_id: { $in: sortedDoctorIds },
                    reccuring: { $ne: true },
                    start_at_utc: { $lt: end },
                    end_at_utc: { $gt: start },
                })
                .lean(),
            this.doctorBlackoutRepository
                .model()
                .find({
                    doctor_id: { $in: sortedDoctorIds },
                    reccuring: true,
                })
                .lean(),
            this.appointmentsRepository
                .model()
                .find({
                    doctor_id: { $in: sortedDoctorIds },
                    status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
                    scheduled_start_at_utc: { $lt: end },
                    scheduled_end_at_utc: { $gt: start },
                })
                .lean(),
        ]);

        const groupByDoctor = <T extends { doctor_id: any }>(items: T[]) => {
            const map = new Map<string, T[]>();
            for (const item of items) {
                const key = String(item.doctor_id);
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(item);
            }
            return map;
        };

        const oneTimeMap = groupByDoctor(oneTimeBlackouts as any[]);
        const recurringMap = groupByDoctor(recurringBlackouts as any[]);
        const appointmentMap = groupByDoctor(existingAppointments as any[]);

        const availabilityMap = new Map(
            validAvailabilities.map((a: any) => [String(a.doctor_id), a]),
        );

        // 5. Iterate candidates — first one with no conflicts wins
        for (const doctor of sortedDoctors) {
            const docId = String(doctor._id);
            const avail = availabilityMap.get(docId) as any;
            const zone = avail?.timezone || DEFAULT_ZONE;

            const docOneTime = oneTimeMap.get(docId) || [];
            if (this.overlapsAny(start, end, docOneTime, 'start_at_utc', 'end_at_utc')) {
                continue;
            }

            const docRecurring = recurringMap.get(docId) || [];
            if (this.overlapsRecurring(start, end, docRecurring, zone)) {
                continue;
            }

            const docAppointments = appointmentMap.get(docId) || [];
            if (this.overlapsAny(start, end, docAppointments, 'scheduled_start_at_utc', 'scheduled_end_at_utc')) {
                continue;
            }

            try {
                return await this.persistAppointmentAndConsultation(
                    patientId,
                    new Types.ObjectId(docId),
                    zone,
                    start,
                    end,
                    dto,
                    AppointmentStatus.CONFIRMED,
                );
            } catch (error: any) {
                if (error?.code === 11000 || error instanceof ConflictException) continue;
                throw error;
            }
        }

        throw new BadRequestException(
            'No available doctor found for the requested time slot. Please try a different time.',
        );
    }

    private validateSlotForDoctor(
        availability: any,
        start: Date,
        end: Date,
        requestedDuration: number,
        zone: string,
    ) {
        if (!this.isWithinEffectiveRange(start, availability.effective_from, availability.effective_to, zone)) {
            throw new BadRequestException('Selected slot is outside doctor availability range');
        }

        const matchedSlot = this.findMatchingWeeklySlot(availability.weekly_slots || [], start, zone);
        if (!matchedSlot) {
            throw new BadRequestException('Selected slot is not part of doctor availability');
        }

        if (requestedDuration % matchedSlot.slot_duration_minutes !== 0) {
            throw new BadRequestException('Requested duration must align with doctor slot interval');
        }

        if (!this.isRangeWithinAvailabilityWindow(availability.weekly_slots || [], start, end, zone)) {
            throw new BadRequestException('Requested duration exceeds available doctor time window');
        }
    }

    private async assertNoConflicts(
        doctorObjectId: Types.ObjectId,
        start: Date,
        end: Date,
        zone: string,
    ) {
        const [overlapBlackout, recurringBlackouts] = await Promise.all([
            this.doctorBlackoutRepository.findOne({
                doctor_id: doctorObjectId,
                reccuring: { $ne: true },
                start_at_utc: { $lt: end },
                end_at_utc: { $gt: start },
            }),
            this.doctorBlackoutRepository.model().find({
                doctor_id: doctorObjectId,
                reccuring: true,
            }).lean(),
        ]);

        if (overlapBlackout || this.overlapsRecurring(start, end, recurringBlackouts, zone)) {
            throw new ConflictException('Selected slot is blocked by doctor blackout');
        }

        const overlapAppointment = await this.appointmentsRepository.findOne({
            doctor_id: doctorObjectId,
            status: {
                $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
            },
            scheduled_start_at_utc: { $lt: end },
            scheduled_end_at_utc: { $gt: start },
        });

        if (overlapAppointment) {
            throw new ConflictException('Selected slot is already booked');
        }
    }

    private async persistAppointmentAndConsultation(
        patientId: string,
        doctorObjectId: Types.ObjectId,
        timezone: string,
        start: Date,
        end: Date,
        dto: CreatePatientAppointmentDto,
        status: AppointmentStatus = AppointmentStatus.PENDING,
    ) {
        const appointmentNumber = this.generateAppointmentNumber(start);
        const appointmentFor = dto.appointment_for ?? AppointmentFor.SELF;

        await this.assertPatientNotDoubleBooked(new Types.ObjectId(patientId), start, end);

        if (appointmentFor === AppointmentFor.SELF) {
            await this.reconcilePatientProfileFromSelfBooking(patientId, dto);
        }

        try {
            const appointment = await this.appointmentsRepository.create({
                appointment_number: appointmentNumber,
                patient_id: new Types.ObjectId(patientId),
                doctor_id: doctorObjectId,
                scheduled_start_at_utc: start,
                scheduled_end_at_utc: end,
                timezone_snapshot: timezone,
                status,
                appointment_for: appointmentFor,
                reason_for_visit: dto.present_complaint || dto.reason_for_visit,
                complaint_brief: dto.complaint_brief,
                Medical_conditions: dto.Medical_conditions || [],
                allergies: dto.allergies || [],
                booking_profile_snapshot: {
                    first_name: dto.first_name,
                    last_name: dto.last_name,
                    date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
                    gender: dto.gender,
                    marital_status: dto.marital_status,
                    occupation: dto.occupation,
                    present_complaint: dto.present_complaint,
                },
            });

            return appointment;
        } catch (error: any) {
            if (error?.code === 11000) {
                throw new ConflictException(
                    'Selected slot is already booked or consultation already linked',
                );
            }
            throw error;
        }
    }

    private async reconcilePatientProfileFromSelfBooking(
        patientId: string,
        dto: CreatePatientAppointmentDto,
    ) {
        const patient = await this.userRepository.findOne({ _id: patientId });
        if (!patient) {
            return;
        }

        const updates: Record<string, unknown> = {};
        const normalized = (value?: string) => (value ?? '').trim().toLowerCase();

        const setIfChanged = (
            field: string,
            nextValue?: string,
            currentValue?: string,
        ) => {
            const next = (nextValue ?? '').trim();
            if (!next || normalized(next) === normalized(currentValue)) {
                return;
            }
            updates[field] = next;
        };

        setIfChanged('first_name', dto.first_name, patient.first_name);
        setIfChanged('last_name', dto.last_name, patient.last_name);
        setIfChanged('gender', dto.gender, patient.gender);
        setIfChanged('marital_status', dto.marital_status, patient.marital_status);
        setIfChanged('occupation', dto.occupation, patient.occupation);
        setIfChanged('timezone', dto.timezone, patient.timezone);

        if (dto.date_of_birth) {
            const nextDob = new Date(dto.date_of_birth);
            const currentDob = patient.date_of_birth
                ? new Date(patient.date_of_birth)
                : null;

            if (
                !Number.isNaN(nextDob.getTime()) &&
                (!currentDob ||
                    Number.isNaN(currentDob.getTime()) ||
                    nextDob.toISOString() !== currentDob.toISOString())
            ) {
                updates.date_of_birth = nextDob;
            }
        }

        if (dto.allergies !== undefined) {
            const nextAllergies = this.normalizeStringArray(dto.allergies);
            const currentAllergies = this.normalizeStringArray(patient.allergies);
            if (!this.stringArraysEqual(nextAllergies, currentAllergies)) {
                updates.allergies = nextAllergies;
            }
        }

        if (dto.Medical_conditions !== undefined) {
            const nextConditions = this.normalizeStringArray(dto.Medical_conditions);
            const currentConditions = this.normalizeStringArray(
                patient.previous_medical_conditions,
            );
            if (!this.stringArraysEqual(nextConditions, currentConditions)) {
                updates.previous_medical_conditions = nextConditions;
            }
        }

        if (updates.first_name || updates.last_name) {
            updates.full_name = this.buildPatientFullName(
                String(updates.first_name ?? patient.first_name),
                String(updates.last_name ?? patient.last_name),
                patient.middle_name,
            );
        }

        if (!Object.keys(updates).length) {
            return;
        }

        await this.userRepository.findOneAndUpdate(
            { _id: patientId },
            { $set: updates },
            {},
        );
    }

    private normalizeStringArray(values?: string[]) {
        return (values ?? [])
            .map((value) => value.trim())
            .filter(Boolean);
    }

    private stringArraysEqual(left: string[], right: string[]) {
        const signature = (items: string[]) =>
            items
                .map((item) => item.toLowerCase())
                .sort()
                .join('\u0000');

        return signature(left) === signature(right);
    }

    private buildPatientFullName(
        firstName?: string,
        lastName?: string,
        middleName?: string,
    ) {
        const parts = [firstName, middleName, lastName]
            .map((part) => (part || '').trim())
            .filter(Boolean);

        return parts.length ? parts.join(' ') : undefined;
    }

    private sortAppointmentsByClosestFuture(items: any[]) {
        const now = Date.now();
        return (items || []).slice().sort((a, b) => {
            const aTime = new Date(a.scheduled_start_at_utc).getTime();
            const bTime = new Date(b.scheduled_start_at_utc).getTime();

            const aUpcoming = aTime >= now;
            const bUpcoming = bTime >= now;

            if (aUpcoming !== bUpcoming) {
                return aUpcoming ? -1 : 1;
            }

            const aDiff = Math.abs(aTime - now);
            const bDiff = Math.abs(bTime - now);
            return aDiff - bDiff;
        });
    }

    private async assertPatientNotDoubleBooked(
        patientObjectId: Types.ObjectId,
        start: Date,
        end: Date,
        excludeAppointmentId?: Types.ObjectId,
    ) {
        const filter: FilterQuery<AppointmentDocument> = {
            patient_id: patientObjectId,
            status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
            scheduled_start_at_utc: { $lt: end },
            scheduled_end_at_utc: { $gt: start },
        };

        if (excludeAppointmentId) {
            filter._id = { $ne: excludeAppointmentId } as any;
        }

        const overlap = await this.appointmentsRepository.findOne(filter);

        if (overlap) {
            throw new ConflictException('You already have an appointment in this time slot');
        }
    }

    private buildAppointmentListStatusFilter(status?: AppointmentStatus) {
        if (status) {
            if (status === AppointmentStatus.COMPLETED) {
                return { $in: [] };
            }

            return status;
        }

        return {
            $nin: [AppointmentStatus.RESCHEDULED, AppointmentStatus.COMPLETED],
        };
    }

    private async attachRescheduledHistory(items: any[]) {
        if (!items || items.length === 0) return items;

        const appointmentNumbers = items
            .map(i => i.appointment_number)
            .filter(Boolean);
        const rescheduledFromIds = items
            .map(i => i.rescheduled_from_appointment_id)
            .filter(Boolean)
            .map(id => new Types.ObjectId(String(typeof id === 'object' && id._id ? id._id : id)));

        if (appointmentNumbers.length === 0 && rescheduledFromIds.length === 0) {
            return items.map(item => ({
                ...item,
                rescheduled_history: [],
            }));
        }

        const historyItems = await this.appointmentsRepository.model().find({
            status: AppointmentStatus.RESCHEDULED,
            $or: [
                ...(appointmentNumbers.length ? [{ appointment_number: { $in: appointmentNumbers } }] : []),
                ...(rescheduledFromIds.length ? [{ _id: { $in: rescheduledFromIds } }] : []),
            ],
        })
            .populate({
                path: 'consultation_id',
                select: 'appointment_id type title details status consultation_id createdAt updatedAt',
            })
            .populate({
                path: 'doctor_id',
                select: 'first_name last_name full_name email specializations profile_picture_url',
            })
            .populate({
                path: 'patient_id',
                select: 'first_name last_name full_name email gender marital_status occupation profile_picture_url',
            })
            .sort({ createdAt: -1 })
            .lean();

        return items.map(item => ({
            ...item,
            rescheduled_history: historyItems.filter(h => {
                const rescheduledFromId = item.rescheduled_from_appointment_id
                    ? String(
                        typeof item.rescheduled_from_appointment_id === 'object' &&
                            item.rescheduled_from_appointment_id._id
                            ? item.rescheduled_from_appointment_id._id
                            : item.rescheduled_from_appointment_id,
                    )
                    : null;

                return (
                    h.appointment_number === item.appointment_number ||
                    (rescheduledFromId && String(h._id) === rescheduledFromId)
                );
            }),
        }));
    }

    async getPatientAppointments(patientId: string, query: PatientAppointmentsQueryDto) {
        const page = query.page || 1;
        const perPage = query.perPage || 20;
        const skip = (page - 1) * perPage;

        const filter: FilterQuery<AppointmentDocument> = {
            patient_id: new Types.ObjectId(patientId),
        };

        filter.status = this.buildAppointmentListStatusFilter(query.status);

        if (query.from || query.to) {
            filter.scheduled_start_at_utc = {};
            if (query.from) filter.scheduled_start_at_utc.$gte = new Date(query.from);
            if (query.to) filter.scheduled_start_at_utc.$lte = new Date(query.to);
        }

        if (query.q?.trim()) {
            const keyword = new RegExp(query.q.trim(), 'i');
            // Search appointment_number directly; for doctor name, pre-fetch matching doctor IDs
            const matchingDoctors = await this.doctorRepository
                .model()
                .find(
                    {
                        $or: [
                            { first_name: keyword },
                            { last_name: keyword },
                            { full_name: keyword },
                        ],
                    },
                    { _id: 1 },
                )
                .lean();

            const doctorIds = matchingDoctors.map((d: any) => d._id);
            filter.$or = [
                { appointment_number: keyword },
                ...(doctorIds.length ? [{ doctor_id: { $in: doctorIds } }] : []),
            ];
        }

        const now = new Date();

        const [items, total] = await Promise.all([
            this.appointmentsRepository
                .model()
                .aggregate([
                    { $match: filter },
                    {
                        $addFields: {
                            is_upcoming: {
                                $cond: {
                                    if: { $gte: ['$scheduled_start_at_utc', now] },
                                    then: 0,
                                    else: 1,
                                },
                            },
                            time_diff: { $abs: { $subtract: ['$scheduled_start_at_utc', now] } },
                        },
                    },
                    { $sort: { is_upcoming: 1, time_diff: 1 } },
                    { $skip: skip },
                    { $limit: perPage },
                    { $project: { is_upcoming: 0, time_diff: 0 } },
                ]),
            this.appointmentsRepository.model().countDocuments(filter),
        ]);

        await this.appointmentsRepository.model().populate(items, {
            path: 'doctor_id',
            select: 'first_name last_name full_name email specializations profile_picture_url',
        });

        const itemsWithHistory = await this.attachRescheduledHistory(items);

        return {
            items: itemsWithHistory,
            pagination: {
                page,
                perPage,
                total,
                totalPages: Math.ceil(total / perPage),
            },
        };
    }

    async getPatientApprovedAppointments(
        patientId: string,
        query: DoctorApprovedAppointmentsQueryDto,
    ) {
        const filter: FilterQuery<AppointmentDocument> = {
            patient_id: new Types.ObjectId(patientId),
            status: AppointmentStatus.CONFIRMED,
        };

        if (query.weekly) {
            const year = query.year || new Date().getUTCFullYear();
            const weekStart = this.getIsoWeekStartUtc(year, query.weekly);
            const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

            filter.scheduled_start_at_utc = {
                $gte: weekStart,
                $lt: weekEnd,
            };
        }

        const items = await this.appointmentsRepository
            .model()
            .find(filter)
            .populate({
                path: 'doctor_id',
                select: 'first_name last_name full_name email specializations profile_picture_url',
            })
            .sort({ scheduled_start_at_utc: -1 })
            .lean();

        const grouped = new Map<string, {
            week: number;
            year: number;
            start_at_utc: string;
            end_at_utc: string;
            items: typeof items;
        }>();

        for (const appt of items) {
            const info = this.getIsoWeekInfo(new Date(appt.scheduled_start_at_utc));
            const key = `${info.year}-W${info.week}`;

            if (!grouped.has(key)) {
                grouped.set(key, {
                    week: info.week,
                    year: info.year,
                    start_at_utc: info.start.toISOString(),
                    end_at_utc: info.end.toISOString(),
                    items: [],
                });
            }

            grouped.get(key)?.items.push(appt);
        }

        return {
            filter: {
                status: AppointmentStatus.CONFIRMED,
                weekly: query.weekly || null,
                year: query.weekly ? query.year || new Date().getUTCFullYear() : null,
            },
            total: items.length,
            groups: Array.from(grouped.values()).sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.week - a.week;
            }),
        };
    }

    async getAllPatientAppointments(patientId: string) {
        const items = await this.appointmentsRepository
            .model()
            .find({
                patient_id: new Types.ObjectId(patientId),
                status: { $ne: AppointmentStatus.RESCHEDULED }
            })
            .populate({
                path: 'consultation_id',
                select: 'appointment_id type title details status consultation_id createdAt updatedAt',
            })
            .sort({ scheduled_start_at_utc: -1 })
            .lean();

        const itemsWithHistory = await this.attachRescheduledHistory(items);
        return this.sortAppointmentsByClosestFuture(itemsWithHistory);
    }

    async getPatientAppointmentById(patientId: string, appointmentId: string) {
        if (!Types.ObjectId.isValid(appointmentId)) {
            throw new BadRequestException('Invalid appointment id');
        }

        const data = await this.appointmentsRepository
            .model()
            .findOne({
                _id: new Types.ObjectId(appointmentId),
                patient_id: new Types.ObjectId(patientId),
            })
            .populate({
                path: 'consultation_id',
                select: 'appointment_id type title details status consultation_id createdAt updatedAt',
            })
            .populate({
                path: 'doctor_id',
                select: 'first_name last_name full_name email specializations profile_picture_url',
            })
            .lean();

        if (!data) {
            throw new NotFoundException('Appointment not found');
        }

        const [appointmentWithHistory] = await this.attachRescheduledHistory([data]);
        return appointmentWithHistory;
    }

    async getPatientAppointmentsByNumber(
        patientId: string,
        appointmentNumber: string,
    ) {
        const normalizedAppointmentNumber = appointmentNumber?.trim();
        if (!normalizedAppointmentNumber) {
            throw new BadRequestException('Appointment number is required');
        }

        const data = await this.appointmentsRepository
            .model()
            .find({
                appointment_number: normalizedAppointmentNumber,
                patient_id: new Types.ObjectId(patientId),
            })
            .populate({
                path: 'consultation_id',
                select: 'appointment_id type title details status consultation_id createdAt updatedAt',
            })
            .populate({
                path: 'doctor_id',
                select: 'first_name last_name full_name email specializations profile_picture_url',
            })
            .sort({ scheduled_start_at_utc: -1 })
            .lean();

        if (!data.length) {
            throw new NotFoundException('Appointment not found');
        }

        return data;
    }

    async cancelPatientAppointment(
        patientId: string,
        appointmentId: string,
        dto: PatientCancelAppointmentDto,
    ) {
        if (!Types.ObjectId.isValid(appointmentId)) {
            throw new BadRequestException('Invalid appointment id');
        }

        const appointment = await this.appointmentsRepository.findOne({
            _id: new Types.ObjectId(appointmentId),
            patient_id: new Types.ObjectId(patientId),
        });

        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.status)) {
            throw new BadRequestException('Only pending or confirmed appointments can be cancelled');
        }

        return this.appointmentsRepository.findOneAndUpdate(
            { _id: appointment._id },
            {
                $set: {
                    status: AppointmentStatus.CANCELED,
                    cancelled_by: Role.PATIENT,
                    cancelled_reason: dto.reason || 'Cancelled by patient',
                },
            },
            {},
        );
    }

    async reschedulePatientAppointment(
        patientId: string,
        appointmentId: string,
        dto: RescheduleAppointmentDto,
    ) {
        if (!Types.ObjectId.isValid(appointmentId)) {
            throw new BadRequestException('Invalid appointment id');
        }

        const appointment = await this.appointmentsRepository.findOne({
            _id: new Types.ObjectId(appointmentId),
            patient_id: new Types.ObjectId(patientId),
        });

        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.status)) {
            throw new BadRequestException('Only pending or confirmed appointments can be rescheduled');
        }

        return this.createRescheduledAppointment(
            appointment,
            dto,
            Role.PATIENT,
            dto.reason || 'Rescheduled by patient',
        );
    }

    async rescheduleDoctorAppointment(
        doctorId: string,
        appointmentId: string,
        dto: RescheduleAppointmentDto,
    ) {
        if (!Types.ObjectId.isValid(appointmentId)) {
            throw new BadRequestException('Invalid appointment id');
        }

        const appointment = await this.appointmentsRepository.findOne({
            _id: new Types.ObjectId(appointmentId),
            doctor_id: new Types.ObjectId(doctorId),
        });

        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.status)) {
            throw new BadRequestException('Only pending or confirmed appointments can be rescheduled');
        }

        return this.createRescheduledAppointment(
            appointment,
            dto,
            Role.DOCTOR,
            dto.reason || 'Rescheduled by doctor',
        );
    }

    async upsertDoctorAvailability(doctorId: string, dto: UpsertDoctorAvailabilityDto) {
        this.validateWeeklySlots(dto.weekly_slots);

        const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : undefined;
        const effectiveTo = dto.effective_to ? new Date(dto.effective_to) : undefined;

        if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
            throw new BadRequestException('effective_from cannot be later than effective_to');
        }

        const doctorObjectId = new Types.ObjectId(doctorId);

        const availability = await this.doctorAvailabilityRepository.findOneAndUpdate(
            { doctor_id: doctorObjectId },
            {
                $set: {
                    doctor_id: doctorObjectId,
                    timezone: dto.timezone,
                    weekly_slots: dto.weekly_slots,
                    effective_from: effectiveFrom,
                    effective_to: effectiveTo,
                },
            },
            { upsert: true },
        );

        return availability;
    }

    async getDoctorAvailability(doctorId: string) {
        const availability = await this.doctorAvailabilityRepository.findOne({
            doctor_id: new Types.ObjectId(doctorId),
        });

        if (!availability) {
            return {
                timezone: null,
                weekly_slots: [],
                effective_from: null,
                effective_to: null,
            };
        }

        return availability;
    }

    async getDoctorSchedule(doctorId: string, query: DoctorScheduleQueryDto) {
        const doctorObjectId = new Types.ObjectId(doctorId);

        // ── Weekly filter ─────────────────────────────────────────────────
        if (query.weekly) {
            const year = query.year ?? new Date().getUTCFullYear();
            const weekStart = this.getIsoWeekStartUtc(year, query.weekly);
            const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

            const [appointments, oneTimeBlackouts, recurringRules, availability] = await Promise.all([
                this.appointmentsRepository
                    .model()
                    .find({
                        doctor_id: doctorObjectId,
                        scheduled_start_at_utc: { $gte: weekStart, $lt: weekEnd },
                        status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
                    })
                    .populate({ path: 'patient_id', select: 'first_name last_name full_name email profile_picture_url' })
                    .populate({
                        path: 'consultation_id',
                        select: 'consultation_id type title status createdAt updatedAt',
                    })
                    .sort({ scheduled_start_at_utc: 1 })
                    .lean(),

                this.doctorBlackoutRepository.model().find({
                    doctor_id: doctorObjectId,
                    reccuring: { $ne: true },
                    start_at_utc: { $lt: weekEnd },
                    end_at_utc: { $gt: weekStart },
                }).lean(),

                this.doctorBlackoutRepository.model().find({ doctor_id: doctorObjectId, reccuring: true }).lean(),

                this.doctorAvailabilityRepository.findOne({ doctor_id: doctorObjectId }),
            ]);

            const defaultZone = availability?.timezone || DEFAULT_ZONE;

            const blackouts = [
                ...oneTimeBlackouts,
                ...this.expandRecurringBlackouts(recurringRules, weekStart, weekEnd, defaultZone),
            ].sort((a, b) => new Date(a.start_at_utc).getTime() - new Date(b.start_at_utc).getTime());

            return {
                week: query.weekly,
                year,
                start_at_utc: weekStart.toISOString(),
                end_at_utc: weekEnd.toISOString(),
                timezone: defaultZone,
                appointments,
                blackouts,
            };
        }

        // ── No filter: return everything ──────────────────────────────────
        const [appointments, blackouts] = await Promise.all([
            this.appointmentsRepository
                .model()
                .find({
                    doctor_id: doctorObjectId,
                    status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
                })
                .populate({ path: 'patient_id', select: 'first_name last_name full_name email profile_picture_url' })
                .populate({
                    path: 'consultation_id',
                    select: 'consultation_id type title status createdAt updatedAt',
                })
                .sort({ scheduled_start_at_utc: 1 })
                .lean(),

            this.doctorBlackoutRepository.model().find({ doctor_id: doctorObjectId }).lean(),
        ]);

        return { appointments, blackouts };
    }

    async getPatientSchedule(patientId: string, query: DoctorScheduleQueryDto) {
        const patientObjectId = new Types.ObjectId(patientId);

        if (query.weekly) {
            const year = query.year ?? new Date().getUTCFullYear();
            const weekStart = this.getIsoWeekStartUtc(year, query.weekly);
            const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

            const appointments = await this.appointmentsRepository
                .model()
                .find({
                    patient_id: patientObjectId,
                    scheduled_start_at_utc: { $gte: weekStart, $lt: weekEnd },
                })
                .populate({ path: 'doctor_id', select: 'first_name last_name full_name email specializations profile_picture_url' })
                .sort({ scheduled_start_at_utc: 1 })
                .lean();

            return {
                week: query.weekly,
                year,
                start_at_utc: weekStart.toISOString(),
                end_at_utc: weekEnd.toISOString(),
                appointments,
            };
        }

        const appointments = await this.appointmentsRepository
            .model()
            .find({ patient_id: patientObjectId })
            .populate({ path: 'doctor_id', select: 'first_name last_name full_name email specializations profile_picture_url' })
            .sort({ scheduled_start_at_utc: 1 })
            .lean();

        return { appointments };
    }

    private expandRecurringBlackouts(
        rules: any[],
        from: Date,
        to: Date,
        defaultZone: string,
    ): any[] {
        if (!rules.length) return [];

        const occurrences: any[] = [];

        for (const rule of rules) {
            const zone = rule.timezone || defaultZone;
            let cursor = DateTime.fromJSDate(from, { zone }).startOf('day');
            const endDt = DateTime.fromJSDate(to, { zone });

            while (cursor < endDt) {
                const dayOfWeek = cursor.weekday % 7;
                if (rule.day_of_week === dayOfWeek) {
                    const startAtLocal = cursor.plus({ minutes: rule.start_time_minutes });
                    const endAtLocal = cursor.plus({ minutes: rule.end_time_minutes });
                    const startAt = startAtLocal.toUTC().toJSDate();
                    const endAt = endAtLocal.toUTC().toJSDate();
                    if (endAt > from && startAt < to) {
                        occurrences.push({
                            _id: rule._id,
                            doctor_id: rule.doctor_id,
                            start_at_utc: startAt.toISOString(),
                            end_at_utc: endAt.toISOString(),
                            timezone: zone,
                            reason: rule.reason,
                            reccuring: true,
                        });
                    }
                }
                cursor = cursor.plus({ days: 1 });
            }
        }

        return occurrences;
    }

    async getDoctorPatients(doctorId: string) {
        const doctorObjectId = new Types.ObjectId(doctorId);

        const patients = await this.appointmentsRepository
            .model()
            .aggregate([
                {
                    $match: {
                        doctor_id: doctorObjectId,
                        status: { $ne: AppointmentStatus.CANCELED },
                    },
                },
                { $sort: { scheduled_start_at_utc: -1 } },
                {
                    $group: {
                        _id: '$patient_id',
                        last_appointment: { $first: '$$ROOT' },
                        total_appointments: { $sum: 1 },
                    },
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        pipeline: [
                            {
                                $project: {
                                    first_name: 1,
                                    last_name: 1,
                                    full_name: 1,
                                    email: 1,
                                    phone_number: 1,
                                    gender: 1,
                                    date_of_birth: 1,
                                    profile_picture_url: 1,
                                },
                            },
                        ],
                        as: 'patient',
                    },
                },
                { $unwind: '$patient' },
                {
                    $project: {
                        _id: 0,
                        patient: 1,
                        total_appointments: 1,
                        last_appointment: {
                            _id: '$last_appointment._id',
                            appointment_number: '$last_appointment.appointment_number',
                            scheduled_start_at_utc: '$last_appointment.scheduled_start_at_utc',
                            scheduled_end_at_utc: '$last_appointment.scheduled_end_at_utc',
                            status: '$last_appointment.status',
                            reason_for_visit: '$last_appointment.reason_for_visit',
                        },
                    },
                },
                { $sort: { 'last_appointment.scheduled_start_at_utc': -1 } },
            ]);

        return patients;
    }

    async getDoctorBlackouts(doctorId: string) {
        return this.doctorBlackoutRepository
            .model()
            .find({ doctor_id: new Types.ObjectId(doctorId) })
            .sort({ start_at_utc: 1 })
            .lean();
    }

    async createDoctorBlackout(doctorId: string, dto: CreateDoctorBlackoutsDto) {
        const doctorObjectId = new Types.ObjectId(doctorId);

        // Resolve each blackout once (local + tz → UTC instants + zonedClock).
        const resolved = dto.blackouts.map((item) => {
            const startAt = localToUtc(item.start_local, item.timezone);
            const endAt = localToUtc(item.end_local, item.timezone);

            if (startAt >= endAt) {
                throw new BadRequestException(
                    `start_local must be before end_local for entry starting at ${item.start_local}`,
                );
            }

            const startClock = zonedClock(startAt, item.timezone);
            const endClock = zonedClock(endAt, item.timezone);

            return {
                item,
                startAt,
                endAt,
                zone: item.timezone,
                dayOfWeek: startClock.dayOfWeek,
                startMins: startClock.minuteOfDay,
                endMins: endClock.minuteOfDay,
            };
        });

        for (const r of resolved) {
            if (r.item.reccuring) {
                // Recurring: only check against other recurring rules on the same weekday
                // in the same zone (cheap pre-filter; safe because both sides are stored in
                // their own zone's local minutes).
                const overlap = await this.doctorBlackoutRepository.findOne({
                    doctor_id: doctorObjectId,
                    reccuring: true,
                    day_of_week: r.dayOfWeek,
                    timezone: r.zone,
                    start_time_minutes: { $lt: r.endMins },
                    end_time_minutes: { $gt: r.startMins },
                });

                if (overlap) {
                    throw new ConflictException(
                        `Recurring blackout on day ${r.dayOfWeek} at ${r.item.start_local} overlaps an existing recurring blackout`,
                    );
                }
            } else {
                // One-time: check against existing one-time date range AND recurring rules
                // (recurring is evaluated per-zone in-memory).
                const [nonRecurringOverlap, recurringRules] = await Promise.all([
                    this.doctorBlackoutRepository.findOne({
                        doctor_id: doctorObjectId,
                        reccuring: { $ne: true },
                        start_at_utc: { $lt: r.endAt },
                        end_at_utc: { $gt: r.startAt },
                    }),
                    this.doctorBlackoutRepository.model().find({
                        doctor_id: doctorObjectId,
                        reccuring: true,
                    }).lean(),
                ]);

                const recurringOverlap = this.overlapsRecurring(
                    r.startAt,
                    r.endAt,
                    recurringRules,
                    r.zone,
                );

                if (nonRecurringOverlap || recurringOverlap) {
                    throw new ConflictException(
                        `Blackout period starting at ${r.item.start_local} overlaps an existing blackout`,
                    );
                }
            }
        }

        const docs = resolved.map((r) => {
            const isRecurring = r.item.reccuring ?? false;
            return {
                doctor_id: doctorObjectId,
                start_at_utc: r.startAt,
                end_at_utc: r.endAt,
                reason: r.item.reason,
                timezone: r.zone,
                reccuring: isRecurring,
                ...(isRecurring && {
                    day_of_week: r.dayOfWeek,
                    start_time_minutes: r.startMins,
                    end_time_minutes: r.endMins,
                }),
            };
        });

        return this.doctorBlackoutRepository.model().insertMany(docs);
    }

    async deleteDoctorBlackout(doctorId: string, blackoutId: string) {
        const deleted = await this.doctorBlackoutRepository.delete({
            _id: new Types.ObjectId(blackoutId),
            doctor_id: new Types.ObjectId(doctorId),
        });

        if (!deleted) {
            throw new NotFoundException('Blackout not found');
        }

        return { message: 'Blackout removed' };
    }

    async getDoctorAppointments(doctorId: string, query: DoctorAppointmentsQueryDto) {
        const page = query.page || 1;
        const perPage = query.perPage || 20;
        const skip = (page - 1) * perPage;

        const filter: FilterQuery<AppointmentDocument> = {
            doctor_id: new Types.ObjectId(doctorId),
        };

        filter.status = this.buildAppointmentListStatusFilter(query.status);

        if (query.from || query.to) {
            filter.scheduled_start_at_utc = {};
            if (query.from) filter.scheduled_start_at_utc.$gte = new Date(query.from);
            if (query.to) filter.scheduled_start_at_utc.$lte = new Date(query.to);
        }

        if (query.q?.trim()) {
            const keyword = new RegExp(query.q.trim(), 'i');
            filter.$or = [
                { appointment_number: keyword },
                { 'booking_profile_snapshot.first_name': keyword },
                { 'booking_profile_snapshot.last_name': keyword },
            ];
        }

        const now = new Date();

        const [items, total] = await Promise.all([
            this.appointmentsRepository
                .model()
                .aggregate([
                    { $match: filter },
                    {
                        $addFields: {
                            is_upcoming: { $cond: { if: { $gte: ['$scheduled_start_at_utc', now] }, then: 0, else: 1 } },
                            time_diff: { $abs: { $subtract: ['$scheduled_start_at_utc', now] } },
                        },
                    },
                    { $sort: { is_upcoming: 1, time_diff: 1 } },
                    { $skip: skip },
                    { $limit: perPage },
                    { $project: { is_upcoming: 0, time_diff: 0 } },
                ]),
            this.appointmentsRepository.model().countDocuments(filter),
        ]);

        const itemsWithHistory = await this.attachRescheduledHistory(items);

        return {
            items: itemsWithHistory,
            pagination: {
                page,
                perPage,
                total,
                totalPages: Math.ceil(total / perPage),
            },
        };
    }

    async getAllDoctorAppointments(doctorId: string) {
        const items = await this.appointmentsRepository
            .model()
            .find({
                doctor_id: new Types.ObjectId(doctorId),
                status: { $ne: AppointmentStatus.RESCHEDULED }
            })
            .populate({
                path: 'consultation_id',
                select: 'appointment_id type title details status consultation_id createdAt updatedAt',
            })
            .sort({ scheduled_start_at_utc: -1 })
            .lean();

        const itemsWithHistory = await this.attachRescheduledHistory(items);
        return this.sortAppointmentsByClosestFuture(itemsWithHistory);
    }

    async getDoctorApprovedAppointments(
        doctorId: string,
        query: DoctorApprovedAppointmentsQueryDto,
    ) {
        const filter: FilterQuery<AppointmentDocument> = {
            doctor_id: new Types.ObjectId(doctorId),
            status: AppointmentStatus.CONFIRMED,
        };

        if (query.weekly) {
            const year = query.year || new Date().getUTCFullYear();
            const weekStart = this.getIsoWeekStartUtc(year, query.weekly);
            const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

            filter.scheduled_start_at_utc = {
                $gte: weekStart,
                $lt: weekEnd,
            };
        }

        const items = await this.appointmentsRepository
            .model()
            .find(filter)
            .populate({
                path: 'patient_id',
                select: 'first_name last_name full_name email gender marital_status occupation profile_picture_url',
            })
            .sort({ scheduled_start_at_utc: -1 })
            .lean();

        const grouped = new Map<string, {
            week: number;
            year: number;
            start_at_utc: string;
            end_at_utc: string;
            items: typeof items;
        }>();

        for (const appt of items) {
            const info = this.getIsoWeekInfo(new Date(appt.scheduled_start_at_utc));
            const key = `${info.year}-W${info.week}`;

            if (!grouped.has(key)) {
                grouped.set(key, {
                    week: info.week,
                    year: info.year,
                    start_at_utc: info.start.toISOString(),
                    end_at_utc: info.end.toISOString(),
                    items: [],
                });
            }

            grouped.get(key)?.items.push(appt);
        }

        return {
            filter: {
                status: AppointmentStatus.CONFIRMED,
                weekly: query.weekly || null,
                year: query.weekly ? query.year || new Date().getUTCFullYear() : null,
            },
            total: items.length,
            groups: Array.from(grouped.values()).sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.week - a.week;
            }),
        };
    }

    /**
     * Returns system-wide available days and time slots across all active doctors.
     *
     * - Fetches all doctor availability records that have at least one active weekly slot.
     * - Filters out inactive doctors and doctors whose effective range does not
     *   overlap the requested year (if year filter is provided).
     * - For each timezone represented, computes all available UTC slots per day-of-week.
     * - Overlapping slots from multiple doctors on the same day are merged.
     *
     * Response shape:
     * {
     *   total_doctors,
     *   total_available_days,   // days (0-6) that have at least one slot
     *   timezones: [
     *     {
     *       timezone: "Africa/Lagos",
     *       doctors_count: 3,
     *       doctor_ids: ["...", "..."],
     *       available_days: [
     *         {
     *           day_of_week: 1,        // 0=Sunday .. 6=Saturday
     *           slots: [
     *             { start_time: "09:00", end_time: "13:00", slot_duration_minutes: 30 },
     *             { start_time: "14:00", end_time: "17:00", slot_duration_minutes: 30 },
     *           ],
     *           doctor_ids: ["..."],
     *           doctor_count: 2,
     *         },
     *         ...
     *       ],
     *     },
     *   ],
     * }
     */
    /**
     * Returns a day-by-day, slot-by-slot availability matrix across ALL active doctors.
     *
     * Each slot shows:
     *   - time:            formatted local time (h:mm A) in the response timezone
     *   - available_doctors: count of doctors free for that 15-minute block
     *   - max_consecutive_slots: longest run of continuous 15-minute blocks,
     *     starting at that window, that any ONE doctor can fulfill (max 4)
     *
     * Only slots within at least one doctor's schedule are included.
     * Slots blocked by existing appointments or blackout periods are excluded.
     *
     * Supports four calling conventions:
     *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=America/Edmonton
     *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   — legacy aliases for explicit date range
     *   ?days_ahead=7                    — next N days starting today UTC
     *   (neither)                        — defaults to next 14 days
     */
    async getSystemAvailabilityMatrix(query: SystemAvailabilityQueryDto) {
        // ── 1. Resolve the date range ─────────────────────────────────────────
        const today = DateTime.utc().toISODate() ?? '';
        let fromStr: string;
        let toStr: string;
        const responseZone = query.timezone || DEFAULT_ZONE;

        if (query.days_ahead != null) {
            fromStr = today;
            toStr = DateTime.fromISO(fromStr, { zone: 'UTC' })
                .plus({ days: query.days_ahead - 1 })
                .toISODate() ?? '';
        } else {
            const explicitStart = query.startDate || query.from;
            const explicitEnd = query.endDate || query.to;

            if (!explicitStart && explicitEnd) {
                throw new BadRequestException('startDate/from is required when endDate/to is provided');
            }

            fromStr = explicitStart || today;
            toStr = explicitEnd || DateTime.fromISO(fromStr, { zone: 'UTC' })
                .plus({ days: 13 })
                .toISODate() || '';
        }

        if (!fromStr || !toStr) {
            throw new BadRequestException('Invalid date range');
        }
        if (fromStr > toStr) {
            throw new BadRequestException('startDate/from must be before or equal to endDate/to');
        }

        // ── 2. Generate all dates in the range ───────────────────────────────
        const dates = this.generateDateRange(fromStr, toStr);
        if (dates.length === 0) {
            return {};
        }

        // ── 3. Fetch all doctor availabilities ───────────────────────────────
        const availabilities = await this.doctorAvailabilityRepository
            .model()
            .find(
                { weekly_slots: { $elemMatch: { is_active: { $ne: false } } } },
                { doctor_id: 1, timezone: 1, weekly_slots: 1, effective_from: 1, effective_to: 1 },
            )
            .lean();

        if (!availabilities.length) return {};

        // ── 4. Filter to active doctors only ────────────────────────────────
        const doctorIds = availabilities.map((a: any) => a.doctor_id);
        const doctors: any[] = await this.doctorRepository
            .model()
            .find({ _id: { $in: doctorIds }, active: true }, { _id: 1 })
            .lean();

        const activeDoctorIds = new Set(doctors.map((d) => String(d._id)));
        const activeAvails = availabilities.filter((a: any) =>
            activeDoctorIds.has(String(a.doctor_id)),
        );

        if (activeAvails.length === 0) return {};

        // ── 5. Bulk-fetch appointments and blackouts for the full range ──────
        const rangeStart = startOfZonedDayUtc(fromStr, responseZone);
        const rangeEnd = endOfZonedDayUtc(toStr, responseZone);

        const [appointments, blackouts] = await Promise.all([
            this.appointmentsRepository
                .model()
                .find({
                    doctor_id: { $in: Array.from(activeDoctorIds) },
                    status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
                    scheduled_start_at_utc: { $lt: rangeEnd },
                    scheduled_end_at_utc: { $gt: rangeStart },
                })
                .select('doctor_id scheduled_start_at_utc scheduled_end_at_utc')
                .lean(),
            this.doctorBlackoutRepository
                .model()
                .find({
                    doctor_id: { $in: Array.from(activeDoctorIds) },
                    $or: [
                        {
                            reccuring: true,
                        },
                        {
                            reccuring: { $ne: true },
                            start_at_utc: { $lt: rangeEnd },
                            end_at_utc: { $gt: rangeStart },
                        },
                    ],
                })
                .select('doctor_id start_at_utc end_at_utc reccuring timezone day_of_week start_time_minutes end_time_minutes')
                .lean(),
        ]);

        // ── 6. Pre-index appointments and blackouts by doctor_id ───────────────
        const doctorAppointments = new Map<string, any[]>();
        for (const appt of appointments) {
            const key = String(appt.doctor_id);
            if (!doctorAppointments.has(key)) doctorAppointments.set(key, []);
            doctorAppointments.get(key)!.push(appt);
        }

        const doctorRecurringBlackouts = new Map<string, any[]>();
        const doctorBlackouts = new Map<string, any[]>();
        for (const bl of blackouts) {
            const key = String(bl.doctor_id);
            if (bl.reccuring) {
                if (!doctorRecurringBlackouts.has(key)) doctorRecurringBlackouts.set(key, []);
                doctorRecurringBlackouts.get(key)!.push(bl);
            } else {
                if (!doctorBlackouts.has(key)) doctorBlackouts.set(key, []);
                doctorBlackouts.get(key)!.push(bl);
            }
        }

        // ── 7. Build the per-day result map ───────────────────────────────────
        const daysResult: Record<string, any> = {};

        for (const dateStr of dates) {
            const responseDayStart = startOfZonedDayUtc(dateStr, responseZone);
            const responseDayEnd = endOfZonedDayUtc(dateStr, responseZone);

            // Collect all doctors who have a slot on this local day-of-week
            const doctorsForDay: Array<{
                doctorId: string;
                zone: string;
                localDate: string;
                daySlots: WeeklySlotDto[];
            }> = [];

            for (const avail of activeAvails) {
                const zone = avail.timezone || DEFAULT_ZONE;
                const localDates = this.getCandidateLocalDatesForUtcRange(
                    responseDayStart,
                    responseDayEnd,
                    zone,
                );

                for (const localDate of localDates) {
                    // Effective range check in the doctor's configured timezone.
                    if (!this.isWithinEffectiveRangeDateStr(localDate, avail.effective_from, avail.effective_to, zone)) {
                        continue;
                    }

                    const utcDayStart = startOfZonedDayUtc(localDate, zone);
                    const { dayOfWeek } = zonedClock(utcDayStart, zone);

                    const daySlots = (avail.weekly_slots || []).filter(
                        (s: WeeklySlotDto) => s.is_active !== false && s.day_of_week === dayOfWeek,
                    );

                    if (daySlots.length === 0) continue;

                    doctorsForDay.push({
                        doctorId: String(avail.doctor_id),
                        zone,
                        localDate,
                        daySlots,
                    });
                }
            }

            if (doctorsForDay.length === 0) continue;

            // Collect all unique UTC slot instants across ALL doctors on this day
            const allSlotInstants = new Map<string, { start: Date; end: Date; doctors: Set<string> }>();

            for (const { doctorId, zone, localDate, daySlots } of doctorsForDay) {
                const utcSlots = this.buildAvailabilityMatrixBlocksForDate(localDate, daySlots, zone)
                    .filter(({ start }) => start >= responseDayStart && start < responseDayEnd);
                for (const { start, end } of utcSlots) {
                    const key = start.toISOString();
                    if (!allSlotInstants.has(key)) {
                        allSlotInstants.set(key, { start, end, doctors: new Set() });
                    }
                    allSlotInstants.get(key)!.doctors.add(doctorId);
                }
            }

            if (allSlotInstants.size === 0) continue;

            // Sorted UTC slot keys (chronological)
            const sortedKeys = Array.from(allSlotInstants.keys()).sort();

            // Build per-doctor free-slot set for this day
            const doctorFreeKeys = new Map<string, Set<string>>();

            for (const { doctorId, zone, localDate, daySlots } of doctorsForDay) {
                const docAppts = doctorAppointments.get(doctorId) ?? [];
                const docBlackouts = doctorBlackouts.get(doctorId) ?? [];
                const docRecurringBlackouts = doctorRecurringBlackouts.get(doctorId) ?? [];

                const utcSlots = this.buildAvailabilityMatrixBlocksForDate(localDate, daySlots, zone)
                    .filter(({ start }) => start >= responseDayStart && start < responseDayEnd);

                for (const { start, end } of utcSlots) {
                    const key = start.toISOString();
                    const blockedByAppt = this.overlapsAny(
                        start, end, docAppts, 'scheduled_start_at_utc', 'scheduled_end_at_utc',
                    );
                    const blockedByBl = this.overlapsAny(
                        start, end, docBlackouts, 'start_at_utc', 'end_at_utc',
                    );
                    const blockedByRecurring = this.overlapsRecurring(start, end, docRecurringBlackouts, zone);

                    if (!blockedByAppt && !blockedByBl && !blockedByRecurring) {
                        if (!doctorFreeKeys.has(doctorId)) doctorFreeKeys.set(doctorId, new Set());
                        doctorFreeKeys.get(doctorId)!.add(key);
                    }
                }
            }

            // ── 8. Compute per-slot metrics ─────────────────────────────────────
            const slotData: Array<any> = [];

            for (const key of sortedKeys) {
                const { start, end, doctors: slotDoctors } = allSlotInstants.get(key)!;

                // available_doctors: count of doctors covering this slot who are free
                let availableDoctorsCount = 0;
                for (const docId of slotDoctors) {
                    if (doctorFreeKeys.get(docId)?.has(key)) availableDoctorsCount++;
                }

                // max_consecutive_slots: longest free run starting at this slot, per doctor
                let maxConsecutive = 0;
                for (const [docId, freeKeys] of doctorFreeKeys) {
                    if (!slotDoctors.has(docId)) continue;

                    // Find doctor's slots in chronological order (only those in the shared set)
                    const docSlotKeys = sortedKeys.filter(
                        (k) => allSlotInstants.get(k)?.doctors.has(docId) && freeKeys.has(k),
                    );

                    const idx = docSlotKeys.indexOf(key);
                    if (idx === -1) continue; // doctor is not free at this slot

                    let run = 1;
                    for (let i = idx + 1; i < docSlotKeys.length; i++) {
                        const prevSlot = allSlotInstants.get(docSlotKeys[i - 1]);
                        const currSlot = allSlotInstants.get(docSlotKeys[i]);

                        // Guard: if key not in allSlotInstants (shouldn't happen), break
                        if (!prevSlot || !currSlot) break;

                        // Consecutive = previous ends exactly when current starts (no gap)
                        const prevEnd = prevSlot.end.getTime();
                        const currStart = currSlot.start.getTime();

                        if (currStart === prevEnd) {
                            run++;
                        } else {
                            break; // gap found — run ends
                        }
                    }
                    if (run > maxConsecutive) {
                        maxConsecutive = Math.min(run, MAX_BOOKABLE_CONSECUTIVE_SLOTS);
                    }
                }

                const dt = DateTime.fromJSDate(start, { zone: responseZone });
                const time12 = dt.toFormat('hh:mm a');

                slotData.push({
                    time: time12,
                    available_doctors: availableDoctorsCount,
                    max_consecutive_slots: maxConsecutive,
                });
            }

            if (slotData.length > 0) {
                daysResult[dateStr] = { slots: slotData };
            }
        }

        return daysResult;
    }

    async getDoctorAppointmentById(doctorId: string, appointmentId: string) {
        if (!Types.ObjectId.isValid(appointmentId)) {
            throw new BadRequestException('Invalid appointment id');
        }

        const data = await this.appointmentsRepository
            .model()
            .findOne({
                _id: new Types.ObjectId(appointmentId),
                doctor_id: new Types.ObjectId(doctorId),
            })
            .populate({
                path: 'consultation_id',
                select: 'appointment_id type title details status consultation_id createdAt updatedAt',
            })
            .populate({
                path: 'patient_id',
                select: 'first_name last_name full_name email gender marital_status occupation profile_picture_url',
            })
            .lean();

        if (!data) {
            throw new NotFoundException('Appointment not found');
        }

        const [appointmentWithHistory] = await this.attachRescheduledHistory([data]);
        return appointmentWithHistory;
    }

    async getDoctorAppointmentsByNumber(
        doctorId: string,
        appointmentNumber: string,
    ) {
        const normalizedAppointmentNumber = appointmentNumber?.trim();
        if (!normalizedAppointmentNumber) {
            throw new BadRequestException('Appointment number is required');
        }

        const data = await this.appointmentsRepository
            .model()
            .find({
                appointment_number: normalizedAppointmentNumber,
                doctor_id: new Types.ObjectId(doctorId),
            })
            .populate({
                path: 'consultation_id',
                select: 'appointment_id type title details status consultation_id createdAt updatedAt',
            })
            .populate({
                path: 'patient_id',
                select: 'first_name last_name full_name email gender marital_status occupation profile_picture_url',
            })
            .sort({ scheduled_start_at_utc: -1 })
            .lean();

        if (!data.length) {
            throw new NotFoundException('Appointment not found');
        }

        return data;
    }

    async confirmAppointment(doctorId: string, appointmentId: string) {
        return this.transitionAppointmentStatus(
            doctorId,
            appointmentId,
            AppointmentStatus.CONFIRMED,
        );
    }

    async cancelAppointment(doctorId: string, appointmentId: string, reason?: string) {
        return this.transitionAppointmentStatus(
            doctorId,
            appointmentId,
            AppointmentStatus.CANCELED,
            reason,
        );
    }

    private async transitionAppointmentStatus(
        doctorId: string,
        appointmentId: string,
        targetStatus: AppointmentStatus,
        reason?: string,
    ) {
        if (!Types.ObjectId.isValid(doctorId)) {
            throw new UnauthorizedException('Only a doctor can perform this action');
        }

        if (!Types.ObjectId.isValid(appointmentId)) {
            throw new BadRequestException('Invalid appointment id');
        }

        const doctor = await this.doctorRepository.findOne({
            _id: new Types.ObjectId(doctorId),
        });

        if (!doctor) {
            throw new UnauthorizedException('Only a doctor can perform this action');
        }

        const appointment = await this.appointmentsRepository.findOne({
            _id: new Types.ObjectId(appointmentId),
            doctor_id: new Types.ObjectId(doctorId),
        });

        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        const canTransition = this.canTransitionStatus(appointment.status, targetStatus);
        if (!canTransition) {
            throw new BadRequestException(
                `Cannot transition appointment from ${appointment.status} to ${targetStatus}`,
            );
        }

        const patch: any = {
            status: targetStatus,
        };

        if (targetStatus === AppointmentStatus.CANCELED) {
            patch.cancelled_by = Role.DOCTOR;
            patch.cancelled_reason = reason || 'Cancelled by doctor';
        }

        const updated = await this.appointmentsRepository.findOneAndUpdate(
            { _id: appointment._id },
            { $set: patch },
            {},
        );

        return updated;
    }

    private async createRescheduledAppointment(
        appointment: AppointmentDocument,
        dto: RescheduleAppointmentDto,
        actorRole: Role,
        reason: string,
    ) {
        const originalDoctorObjectId = new Types.ObjectId(String(appointment.doctor_id));
        const patientObjectId = new Types.ObjectId(String(appointment.patient_id));
        const appointmentObjectId = new Types.ObjectId(String(appointment._id));

        const start = localToUtc(dto.scheduled_start_local, dto.timezone);

        if (start.getTime() < Date.now()) {
            throw new BadRequestException('Cannot reschedule to a past timeslot');
        }

        if (start.getTime() === new Date(appointment.scheduled_start_at_utc).getTime()) {
            throw new BadRequestException('New timeslot must be different from current timeslot');
        }

        const end = new Date(start.getTime() + dto.requested_duration_minutes * 60 * 1000);

        // 1) Try original doctor first
        const originalCheck = await this.checkDoctorRescheduleSlotAvailability(
            originalDoctorObjectId,
            start,
            end,
            dto.requested_duration_minutes,
            appointmentObjectId,
        );

        // 2) Try fallback doctors only when the original doctor is unavailable.
        let selectedDoctorId: Types.ObjectId | null = originalDoctorObjectId;
        let selectedTimezone = originalCheck.timezone || appointment.timezone_snapshot || 'UTC';
        let selectedStatus = originalCheck.available
            ? AppointmentStatus.CONFIRMED
            : AppointmentStatus.PENDING;
        let fallbackUsed = false;
        let fallbackReason: string | null = null;

        if (!originalCheck.available) {
            fallbackUsed = true;
            fallbackReason = originalCheck.reason;

            const fallbackCandidates = await this.findRescheduleFallbackDoctors(
                start,
                end,
                dto.requested_duration_minutes,
                originalDoctorObjectId,
                appointmentObjectId,
            );

            if (!fallbackCandidates.length) {
                selectedDoctorId = originalDoctorObjectId;
                selectedTimezone = originalCheck.timezone || appointment.timezone_snapshot || 'UTC';
                selectedStatus = AppointmentStatus.PENDING;
                fallbackReason =
                    fallbackReason || 'No doctor currently available; appointment created as pending for later matching';
            } else {
                const originalDoctor = await this.doctorRepository.findOne({
                    _id: originalDoctorObjectId,
                    active: true,
                });

                const oldDoctorSpecializations = ((originalDoctor as any)?.specializations || [])
                    .map((s: string) => s.trim().toLowerCase())
                    .filter(Boolean);
                const requestedSpecialization = dto.requested_specialization?.trim().toLowerCase() || null;

                const tier1 = fallbackCandidates.filter((c) =>
                    c.specializations.some((s) => oldDoctorSpecializations.includes(s)),
                );
                const tier2 = fallbackCandidates.filter(
                    (c) => !!requestedSpecialization && c.specializations.includes(requestedSpecialization),
                );
                const rankedCandidates = [
                    ...tier1,
                    ...tier2.filter((c) => !tier1.some((t) => String(t.doctor_id) === String(c.doctor_id))),
                    ...fallbackCandidates.filter(
                        (c) =>
                            !tier1.some((t) => String(t.doctor_id) === String(c.doctor_id)) &&
                            !tier2.some((t) => String(t.doctor_id) === String(c.doctor_id)),
                    ),
                ];

                selectedDoctorId = rankedCandidates[0].doctor_id;
                selectedTimezone = rankedCandidates[0].timezone;
                selectedStatus = AppointmentStatus.CONFIRMED;
            }
        }

        const appointmentNumber =
            appointment.appointment_number || this.generateAppointmentNumber(start);

        const existingSameStart = await this.appointmentsRepository
            .model()
            .findOne({
                appointment_number: appointmentNumber,
                scheduled_start_at_utc: start,
                _id: { $ne: appointmentObjectId },
            })
            .select('_id')
            .exec();

        if (existingSameStart) {
            throw new BadRequestException('Cannot reschedule to a previous timeslot');
        }

        for (let i = 0; i < 3; i++) {
            try {
                const newAppointmentPayload: any = {
                    appointment_number: appointmentNumber,
                    patient_id: patientObjectId,
                    scheduled_start_at_utc: start,
                    scheduled_end_at_utc: end,
                    timezone_snapshot: selectedTimezone,
                    status: selectedStatus,
                    reason_for_visit: appointment.reason_for_visit,
                    complaint_brief: appointment.complaint_brief,
                    Medical_conditions: appointment.Medical_conditions || [],
                    allergies: appointment.allergies || [],
                    booking_profile_snapshot: appointment.booking_profile_snapshot,
                    rescheduled_from_appointment_id: appointmentObjectId,
                };

                if (selectedDoctorId) {
                    newAppointmentPayload.doctor_id = selectedDoctorId;
                }

                const newAppointment = await this.appointmentsRepository.create(newAppointmentPayload);

                // Mark old consultation as RESCHEDULED (if one exists)
                await this.consultationModel.updateOne(
                    { appointment_id: appointmentObjectId },
                    { $set: { status: ConsultationStatusEnum.RESCHEDULED } },
                );

                await this.appointmentsRepository.findOneAndUpdate(
                    { _id: appointmentObjectId },
                    {
                        $set: {
                            status: AppointmentStatus.RESCHEDULED,
                            cancelled_by: actorRole,
                            cancelled_reason: reason,
                        },
                    },
                    {},
                );

                return {
                    old_appointment_id: appointmentObjectId,
                    fallback_used: fallbackUsed,
                    fallback_reason: fallbackReason,
                    awaiting_doctor_assignment: !selectedDoctorId,
                    new_appointment: newAppointment,
                };
            } catch (error: any) {
                if (error?.code === 11000) {
                    const keyPattern = (error?.keyPattern || {}) as Record<string, any>;
                    const keyValue = (error?.keyValue || {}) as Record<string, any>;

                    if (keyPattern.appointment_number || keyValue.appointment_number) {
                        throw new ConflictException(
                            'appointment_number must remain the same for reschedules. ' +
                            'Remove any unique index on appointment_number to allow rescheduled appointments to share the same number.',
                        );
                    }

                    if (!fallbackUsed || !selectedDoctorId) {
                        throw new ConflictException('Selected slot is already booked');
                    }

                    const refreshedCandidates = await this.findRescheduleFallbackDoctors(
                        start,
                        end,
                        dto.requested_duration_minutes,
                        originalDoctorObjectId,
                        appointmentObjectId,
                    );

                    const nextCandidate = refreshedCandidates.find(
                        (c) => String(c.doctor_id) !== String(selectedDoctorId),
                    );

                    if (!nextCandidate) {
                        selectedDoctorId = originalDoctorObjectId;
                        selectedStatus = AppointmentStatus.PENDING;
                        fallbackReason =
                            fallbackReason || 'No doctor currently available; appointment created as pending for later matching';
                        continue;
                    }

                    selectedDoctorId = nextCandidate.doctor_id;
                    selectedTimezone = nextCandidate.timezone;
                    selectedStatus = AppointmentStatus.CONFIRMED;
                    continue;
                }
                throw error;
            }
        }

        throw new ConflictException('No available doctor found for the requested reschedule slot');
    }

    private async checkDoctorRescheduleSlotAvailability(
        doctorObjectId: Types.ObjectId,
        start: Date,
        end: Date,
        requestedDuration: number,
        excludedAppointmentId?: Types.ObjectId,
    ) {
        const availability = await this.doctorAvailabilityRepository.findOne({
            doctor_id: doctorObjectId,
        });

        if (!availability) {
            return { available: false, reason: 'Doctor has no configured availability', timezone: DEFAULT_ZONE };
        }

        const zone = availability.timezone || DEFAULT_ZONE;

        if (!this.isWithinEffectiveRange(start, availability.effective_from, availability.effective_to, zone)) {
            return { available: false, reason: 'Selected slot is outside doctor availability range', timezone: zone };
        }

        const matchedSlot = this.findMatchingWeeklySlot(availability.weekly_slots || [], start, zone);
        if (!matchedSlot) {
            return { available: false, reason: 'Selected slot is not part of doctor availability', timezone: zone };
        }

        if (requestedDuration % matchedSlot.slot_duration_minutes !== 0) {
            return { available: false, reason: 'Requested duration must align with doctor slot interval', timezone: zone };
        }

        const fitsInWindow = this.isRangeWithinAvailabilityWindow(
            availability.weekly_slots || [],
            start,
            end,
            zone,
        );

        if (!fitsInWindow) {
            return { available: false, reason: 'Requested duration exceeds available doctor time window', timezone: zone };
        }

        const [overlapBlackout, recurringBlackouts] = await Promise.all([
            this.doctorBlackoutRepository.findOne({
                doctor_id: doctorObjectId,
                reccuring: { $ne: true },
                start_at_utc: { $lt: end },
                end_at_utc: { $gt: start },
            }),
            this.doctorBlackoutRepository.model().find({
                doctor_id: doctorObjectId,
                reccuring: true,
            }).lean(),
        ]);

        if (overlapBlackout || this.overlapsRecurring(start, end, recurringBlackouts, zone)) {
            return { available: false, reason: 'Selected slot is blocked by doctor blackout', timezone: zone };
        }

        const overlapFilter: FilterQuery<AppointmentDocument> = {
            doctor_id: doctorObjectId,
            status: {
                $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
            },
            scheduled_start_at_utc: { $lt: end },
            scheduled_end_at_utc: { $gt: start },
        };

        if (excludedAppointmentId) {
            overlapFilter._id = { $ne: excludedAppointmentId };
        }

        const overlapAppointment = await this.appointmentsRepository.findOne(overlapFilter);

        if (overlapAppointment) {
            return { available: false, reason: 'Selected slot is already booked', timezone: zone };
        }

        return { available: true, reason: null, timezone: zone };
    }

    private async findRescheduleFallbackDoctors(
        start: Date,
        end: Date,
        requestedDuration: number,
        excludedDoctorId: Types.ObjectId,
        excludedAppointmentId: Types.ObjectId,
    ): Promise<Array<{ doctor_id: Types.ObjectId; timezone: string; specializations: string[] }>> {
        // Day-of-week varies per zone; fetch all availabilities with at least one active slot.
        const availabilities = await this.doctorAvailabilityRepository
            .model()
            .find({
                weekly_slots: { $elemMatch: { is_active: { $ne: false } } },
                doctor_id: { $ne: excludedDoctorId },
            })
            .lean();

        if (!availabilities.length) {
            return [];
        }

        const validAvailabilities = availabilities.filter((avail: any) => {
            const zone = avail.timezone || DEFAULT_ZONE;
            if (!this.isWithinEffectiveRange(start, avail.effective_from, avail.effective_to, zone)) {
                return false;
            }

            const matchedSlot = this.findMatchingWeeklySlot(avail.weekly_slots || [], start, zone);
            if (!matchedSlot) return false;
            if (requestedDuration % matchedSlot.slot_duration_minutes !== 0) return false;
            return this.isRangeWithinAvailabilityWindow(avail.weekly_slots || [], start, end, zone);
        });

        if (!validAvailabilities.length) {
            return [];
        }

        const candidateDoctorIds = validAvailabilities.map((a: any) => a.doctor_id);
        const doctors = await this.doctorRepository
            .model()
            .find(
                { _id: { $in: candidateDoctorIds }, active: true },
                { _id: 1, specializations: 1 },
            )
            .lean();

        if (!doctors.length) {
            return [];
        }

        const activeDoctorIds = doctors.map((d: any) => d._id);
        const [oneTimeBlackouts, recurringBlackouts, existingAppointments] = await Promise.all([
            this.doctorBlackoutRepository.model().find({
                doctor_id: { $in: activeDoctorIds },
                reccuring: { $ne: true },
                start_at_utc: { $lt: end },
                end_at_utc: { $gt: start },
            }).lean(),
            this.doctorBlackoutRepository.model().find({
                doctor_id: { $in: activeDoctorIds },
                reccuring: true,
            }).lean(),
            this.appointmentsRepository.model().find({
                doctor_id: { $in: activeDoctorIds },
                status: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
                _id: { $ne: excludedAppointmentId },
                scheduled_start_at_utc: { $lt: end },
                scheduled_end_at_utc: { $gt: start },
            }).lean(),
        ]);

        const groupByDoctor = <T extends { doctor_id: any }>(items: T[]) => {
            const map = new Map<string, T[]>();
            for (const item of items) {
                const key = String(item.doctor_id);
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(item);
            }
            return map;
        };

        const oneTimeMap = groupByDoctor(oneTimeBlackouts as any[]);
        const recurringMap = groupByDoctor(recurringBlackouts as any[]);
        const appointmentMap = groupByDoctor(existingAppointments as any[]);
        const availabilityMap = new Map(validAvailabilities.map((a: any) => [String(a.doctor_id), a]));

        const available: Array<{ doctor_id: Types.ObjectId; timezone: string; specializations: string[] }> = [];

        for (const doctor of doctors as any[]) {
            const docId = String(doctor._id);
            const avail = availabilityMap.get(docId) as any;
            const zone = avail?.timezone || DEFAULT_ZONE;

            const docOneTime = oneTimeMap.get(docId) || [];
            if (this.overlapsAny(start, end, docOneTime, 'start_at_utc', 'end_at_utc')) continue;

            const docRecurring = recurringMap.get(docId) || [];
            if (this.overlapsRecurring(start, end, docRecurring, zone)) continue;

            const docAppointments = appointmentMap.get(docId) || [];
            if (this.overlapsAny(start, end, docAppointments, 'scheduled_start_at_utc', 'scheduled_end_at_utc')) continue;

            available.push({
                doctor_id: doctor._id,
                timezone: zone,
                specializations: ((doctor.specializations || []) as string[])
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean),
            });
        }

        return available;
    }

    private canTransitionStatus(
        currentStatus: AppointmentStatus,
        targetStatus: AppointmentStatus,
    ): boolean {
        const map: Record<AppointmentStatus, AppointmentStatus[]> = {
            [AppointmentStatus.PENDING]: [
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.CANCELED,
            ],
            [AppointmentStatus.CONFIRMED]: [
                AppointmentStatus.COMPLETED,
                AppointmentStatus.CANCELED,
            ],
            [AppointmentStatus.COMPLETED]: [],
            [AppointmentStatus.CANCELED]: [],
            [AppointmentStatus.RESCHEDULED]: [],
        };

        return map[currentStatus]?.includes(targetStatus) || false;
    }

    private validateWeeklySlots(slots: WeeklySlotDto[]) {
        const grouped = new Map<number, WeeklySlotDto[]>();

        for (const slot of slots) {
            const start = this.toMinutes(slot.start_time);
            const end = this.toMinutes(slot.end_time);

            if (start >= end) {
                throw new BadRequestException('Slot start_time must be earlier than end_time');
            }

            const duration = end - start;
            if (duration < slot.slot_duration_minutes) {
                throw new BadRequestException('slot_duration_minutes is larger than slot range');
            }

            if (duration % slot.slot_duration_minutes !== 0) {
                throw new BadRequestException(
                    'slot_duration_minutes must divide the slot range exactly',
                );
            }

            const byDay = grouped.get(slot.day_of_week) || [];
            byDay.push(slot);
            grouped.set(slot.day_of_week, byDay);
        }

        for (const [, daySlots] of grouped) {
            const sorted = [...daySlots].sort(
                (a, b) => this.toMinutes(a.start_time) - this.toMinutes(b.start_time),
            );

            for (let i = 1; i < sorted.length; i++) {
                const prevEnd = this.toMinutes(sorted[i - 1].end_time);
                const currentStart = this.toMinutes(sorted[i].start_time);

                if (currentStart < prevEnd) {
                    throw new BadRequestException('Weekly slots overlap within the same day');
                }
            }
        }
    }

    private toMinutes(value: string): number {
        const [hour, minute] = value.split(':').map(Number);
        return hour * 60 + minute;
    }

    /** Minutes from midnight in the given zone (0..1439). */
    private timeMinutes(date: Date, zone: string): number {
        return zonedClock(date, zone).minuteOfDay;
    }

    private overlapsRecurring(
        slotStart: Date,
        slotEnd: Date,
        recurringBlackouts: any[],
        zone: string,
    ): boolean {
        const startMins = this.timeMinutes(slotStart, zone);
        const endMins = this.timeMinutes(slotEnd, zone);
        const dayOfWeek = zonedClock(slotStart, zone).dayOfWeek;
        return recurringBlackouts.some((b) => {
            if (b.day_of_week !== dayOfWeek) return false;
            const blackoutZone = b.timezone || zone;
            if (blackoutZone !== zone) {
                // Mixed zones — re-evaluate instant against the blackout's own zone.
                const instantClock = zonedClock(slotStart, blackoutZone);
                const instantEndClock = zonedClock(slotEnd, blackoutZone);
                if (instantClock.dayOfWeek !== b.day_of_week) return false;
                return (
                    b.start_time_minutes < instantEndClock.minuteOfDay &&
                    b.end_time_minutes > instantClock.minuteOfDay
                );
            }
            return b.start_time_minutes < endMins && b.end_time_minutes > startMins;
        });
    }

    /** Validate a "YYYY-MM-DD" string. Returned value is informational — callers should pair with a zone. */
    private assertIsoDateOnly(value: string): string {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new BadRequestException('Invalid date. Expected format: YYYY-MM-DD');
        }
        return value;
    }

    /** Start of the local calendar day in `zone`, as a UTC instant. */
    private dayStartUtc(dateStr: string, zone: string): Date {
        return startOfZonedDayUtc(dateStr, zone);
    }

    /** Exclusive end (next local day at 00:00) of the local calendar day in `zone`, as a UTC instant. */
    private dayEndUtc(dateStr: string, zone: string): Date {
        return endOfZonedDayUtc(dateStr, zone);
    }

    private isWithinEffectiveRange(
        target: Date,
        effectiveFrom?: Date,
        effectiveTo?: Date,
        zone: string = DEFAULT_ZONE,
    ): boolean {
        const targetDate = zonedIsoDate(target, zone);
        if (effectiveFrom) {
            const fromDate = zonedIsoDate(new Date(effectiveFrom), zone);
            if (targetDate < fromDate) return false;
        }
        if (effectiveTo) {
            const toDate = zonedIsoDate(new Date(effectiveTo), zone);
            if (targetDate > toDate) return false;
        }
        return true;
    }

    /**
     * Build all slot instants (UTC) for a local calendar day in `zone`.
     * Each slot's local HH:mm is interpreted in `zone`, producing a DST-correct UTC Date.
     */
    private buildSlotsForDate(
        dateStr: string,
        daySlots: WeeklySlotDto[],
        zone: string,
    ): Array<{ start: Date; end: Date }> {
        const slots: Array<{ start: Date; end: Date }> = [];

        for (const slot of daySlots) {
            const startMinute = this.toMinutes(slot.start_time);
            const endMinute = this.toMinutes(slot.end_time);

            for (
                let m = startMinute;
                m + slot.slot_duration_minutes <= endMinute;
                m += slot.slot_duration_minutes
            ) {
                const hh = String(Math.floor(m / 60)).padStart(2, '0');
                const mm = String(m % 60).padStart(2, '0');
                const slotStart = zonedDateAndTimeToUtc(dateStr, `${hh}:${mm}`, zone);
                const slotEnd = new Date(
                    slotStart.getTime() + slot.slot_duration_minutes * 60 * 1000,
                );
                slots.push({ start: slotStart, end: slotEnd });
            }
        }

        return slots;
    }

    /**
     * Build the availability matrix on the product's fixed 15-minute grid.
     * This intentionally ignores `slot_duration_minutes`; that field controls
     * doctor booking granularity elsewhere, while this endpoint reports
     * continuous 15-minute blocks for frontend duration validation.
     */
    private buildAvailabilityMatrixBlocksForDate(
        dateStr: string,
        daySlots: WeeklySlotDto[],
        zone: string,
    ): Array<{ start: Date; end: Date }> {
        const slots: Array<{ start: Date; end: Date }> = [];

        for (const slot of daySlots) {
            const startMinute = this.toMinutes(slot.start_time);
            const endMinute = this.toMinutes(slot.end_time);

            for (
                let m = startMinute;
                m + AVAILABILITY_MATRIX_SLOT_MINUTES <= endMinute;
                m += AVAILABILITY_MATRIX_SLOT_MINUTES
            ) {
                const hh = String(Math.floor(m / 60)).padStart(2, '0');
                const mm = String(m % 60).padStart(2, '0');
                const slotStart = zonedDateAndTimeToUtc(dateStr, `${hh}:${mm}`, zone);
                const slotEnd = new Date(
                    slotStart.getTime() + AVAILABILITY_MATRIX_SLOT_MINUTES * 60 * 1000,
                );
                slots.push({ start: slotStart, end: slotEnd });
            }
        }

        return slots;
    }

    private overlapsAny(
        start: Date,
        end: Date,
        records: any[],
        startKey: string,
        endKey: string,
    ): boolean {
        return records.some((r) => {
            const rStart = new Date(r[startKey]);
            const rEnd = new Date(r[endKey]);
            return rStart < end && rEnd > start;
        });
    }

    private findMatchingWeeklySlot(
        weeklySlots: WeeklySlotDto[],
        start: Date,
        zone: string,
    ): WeeklySlotDto | null {
        const { dayOfWeek, minuteOfDay } = zonedClock(start, zone);

        for (const slot of weeklySlots) {
            if (slot.is_active === false) continue;
            if (slot.day_of_week !== dayOfWeek) continue;

            const slotStart = this.toMinutes(slot.start_time);
            const slotEnd = this.toMinutes(slot.end_time);

            if (minuteOfDay < slotStart || minuteOfDay >= slotEnd) continue;

            const offset = minuteOfDay - slotStart;
            if (offset % slot.slot_duration_minutes !== 0) continue;

            if (minuteOfDay + slot.slot_duration_minutes > slotEnd) continue;

            return slot;
        }

        return null;
    }

    private isRangeWithinAvailabilityWindow(
        weeklySlots: WeeklySlotDto[],
        start: Date,
        end: Date,
        zone: string,
    ): boolean {
        const startClock = zonedClock(start, zone);
        const endClock = zonedClock(end, zone);

        // Booking must remain within the same local calendar day in `zone`.
        if (startClock.isoDate !== endClock.isoDate) return false;

        return weeklySlots.some((slot) => {
            if (slot.is_active === false) return false;
            if (slot.day_of_week !== startClock.dayOfWeek) return false;

            const slotStart = this.toMinutes(slot.start_time);
            const slotEnd = this.toMinutes(slot.end_time);

            return (
                startClock.minuteOfDay >= slotStart && endClock.minuteOfDay <= slotEnd
            );
        });
    }

    private generateAppointmentNumber(date: Date): string {
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(date.getUTCDate()).padStart(2, '0');
        const rand = Math.floor(1000 + Math.random() * 9000);
        return `APT-${yyyy}${mm}${dd}-${rand}`;
    }

    private generateConsultationCode(): string {
        const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
        return `BOOK-${rand}`;
    }

    private getIsoWeekInfo(date: Date) {
        const normalized = new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
        );

        const day = normalized.getUTCDay() || 7;
        normalized.setUTCDate(normalized.getUTCDate() + 4 - day);

        const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        const year = normalized.getUTCFullYear();

        const start = this.getIsoWeekStartUtc(year, week);
        const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

        return { week, year, start, end };
    }

    private isWithinEffectiveRangeDateStr(
        dateStr: string,
        effectiveFrom?: Date,
        effectiveTo?: Date,
        zone = DEFAULT_ZONE,
    ): boolean {
        if (effectiveFrom) {
            const fromDateStr = DateTime.fromJSDate(new Date(effectiveFrom), { zone }).toISODate();
            if (fromDateStr && dateStr < fromDateStr) return false;
        }
        if (effectiveTo) {
            const toDateStr = DateTime.fromJSDate(new Date(effectiveTo), { zone }).toISODate();
            if (toDateStr && dateStr > toDateStr) return false;
        }
        return true;
    }

    private getCandidateLocalDatesForUtcRange(start: Date, end: Date, zone: string): string[] {
        const endInclusive = new Date(end.getTime() - 1);
        const dates = new Set<string>();

        const startDate = zonedIsoDate(start, zone);
        const endDate = zonedIsoDate(endInclusive, zone);

        if (startDate) dates.add(startDate);
        if (endDate) dates.add(endDate);

        return Array.from(dates);
    }

    private generateDateRange(fromStr: string, toStr: string): string[] {
        const dates: string[] = [];
        let current = DateTime.fromISO(fromStr, { zone: 'UTC' });
        const end = DateTime.fromISO(toStr, { zone: 'UTC' });

        while (current <= end) {
            const s = current.toISODate();
            if (s) dates.push(s);
            current = current.plus({ days: 1 });
        }

        return dates;
    }

    private getIsoWeekStartUtc(year: number, week: number): Date {
        const fourthJan = new Date(Date.UTC(year, 0, 4));
        const day = fourthJan.getUTCDay() || 7;
        const weekOneMonday = new Date(fourthJan);
        weekOneMonday.setUTCDate(fourthJan.getUTCDate() - day + 1);

        const result = new Date(weekOneMonday);
        result.setUTCDate(weekOneMonday.getUTCDate() + (week - 1) * 7);
        result.setUTCHours(0, 0, 0, 0);

        return result;
    }
}

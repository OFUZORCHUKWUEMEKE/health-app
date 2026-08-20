import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { AppointmentFor, AppointmentStatus, Role } from 'src/common/enums';
import { BookingsService } from './bookings.service';

/**
 * The service refuses to reschedule into a past timeslot, so specs that book or
 * reschedule have to target a slot that is still in the future whenever the
 * suite runs. Deriving the slot from the clock keeps these specs from rotting
 * the way a hardcoded ISO string does.
 *
 * Returns 00:00 UTC on the first Monday at least `minDaysAhead` days out —
 * Monday because the mocked weekly availability below uses `day_of_week: 1`
 * (0 = Sunday .. 6 = Saturday).
 */
function futureUtcMonday(minDaysAhead = 7): DateTime {
    let day = DateTime.utc().startOf('day').plus({ days: minDaysAhead });
    while (day.weekday !== 1) {
        day = day.plus({ days: 1 });
    }
    return day;
}

/** Wall-clock "YYYY-MM-DDTHH:mm:ss" for the given time of day on `day`. */
function localIsoAt(day: DateTime, hour: number, minute = 0): string {
    return (
        day.set({ hour, minute }).toISO({ includeOffset: false, suppressMilliseconds: true }) ?? ''
    );
}

describe('BookingsService', () => {
    const doctorAvailabilityRepository = {
        findOne: jest.fn(),
        model: jest.fn(),
    };
    const doctorBlackoutRepository = {
        findOne: jest.fn(),
        model: jest.fn(),
    };
    const appointmentsRepository = {
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        create: jest.fn(),
        model: jest.fn(),
    };
    const doctorRepository = {
        findOne: jest.fn(),
    };
    const consultationModel = {
        updateOne: jest.fn(),
    };
    const configService = {
        get: jest.fn(),
    };
    const userRepository = {
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
    };
    // Notifications hang off domain events. Asserting on this mock is how the specs check
    // that an event fires exactly once on success and not at all on a failure path.
    const eventEmitter = {
        emit: jest.fn(),
    };

    let service: BookingsService;

    beforeEach(() => {
        jest.clearAllMocks();

        service = new BookingsService(
            doctorAvailabilityRepository as any,
            doctorBlackoutRepository as any,
            appointmentsRepository as any,
            doctorRepository as any,
            consultationModel as any,
            configService as any,
            userRepository as any,
            eventEmitter as any,
        );

        doctorBlackoutRepository.findOne.mockResolvedValue(null);
        doctorBlackoutRepository.model.mockReturnValue({
            find: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([]),
            }),
        });
        appointmentsRepository.model.mockReturnValue({
            findOne: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                    exec: jest.fn().mockResolvedValue(null),
                }),
            }),
        });
        consultationModel.updateOne.mockResolvedValue({});
    });

    it('marks the old appointment as RESCHEDULED when a patient reschedules', async () => {
        const patientId = new Types.ObjectId();
        const doctorId = new Types.ObjectId();
        const appointmentId = new Types.ObjectId();
        // Original slot 09:00-09:30, rescheduled to 10:00 on the same upcoming Monday.
        const slotDay = futureUtcMonday();
        const appointment = {
            _id: appointmentId,
            appointment_number: 'APT-20260620-1234',
            patient_id: patientId,
            doctor_id: doctorId,
            scheduled_start_at_utc: slotDay.set({ hour: 9 }).toJSDate(),
            scheduled_end_at_utc: slotDay.set({ hour: 9, minute: 30 }).toJSDate(),
            timezone_snapshot: 'UTC',
            status: AppointmentStatus.CONFIRMED,
            reason_for_visit: 'Follow up',
            complaint_brief: 'Brief complaint',
            Medical_conditions: [],
            allergies: [],
            booking_profile_snapshot: {
                first_name: 'Ada',
                last_name: 'Lovelace',
            },
        };
        const newAppointment = {
            _id: new Types.ObjectId(),
            status: AppointmentStatus.CONFIRMED,
        };

        appointmentsRepository.findOne.mockImplementation(async (filter) => {
            if (filter._id?.toString?.() === appointmentId.toString() && filter.patient_id) {
                return appointment;
            }
            return null;
        });
        doctorAvailabilityRepository.findOne.mockResolvedValue({
            doctor_id: doctorId,
            timezone: 'UTC',
            weekly_slots: [
                {
                    day_of_week: 1,
                    start_time: '09:00',
                    end_time: '17:00',
                    slot_duration_minutes: 30,
                    is_active: true,
                },
            ],
        });
        appointmentsRepository.create.mockResolvedValue(newAppointment);
        appointmentsRepository.findOneAndUpdate.mockResolvedValue({
            ...appointment,
            status: AppointmentStatus.RESCHEDULED,
        });

        const result = await service.reschedulePatientAppointment(
            patientId.toString(),
            appointmentId.toString(),
            {
                scheduled_start_local: localIsoAt(slotDay, 10),
                timezone: 'UTC',
                requested_duration_minutes: 30,
                reason: 'Need a later time',
            },
        );

        expect(appointmentsRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                status: AppointmentStatus.CONFIRMED,
                rescheduled_from_appointment_id: appointmentId,
            }),
        );
        expect(appointmentsRepository.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: appointmentId },
            {
                $set: {
                    status: AppointmentStatus.RESCHEDULED,
                    cancelled_by: Role.PATIENT,
                    cancelled_reason: 'Need a later time',
                },
            },
            {},
        );
        expect(result.old_appointment_id).toEqual(appointmentId);
    });

    it('reconciles patient allergies when booking an appointment for self', async () => {
        const patientId = new Types.ObjectId();
        const slotDay = futureUtcMonday();

        userRepository.findOne.mockResolvedValue({
            _id: patientId,
            first_name: 'Ada',
            last_name: 'Okafor',
            allergies: ['Penicillin'],
            previous_medical_conditions: ['Hypertension'],
        });
        userRepository.findOneAndUpdate.mockResolvedValue({});

        await (service as any).reconcilePatientProfileFromSelfBooking(patientId.toString(), {
            first_name: 'Ada',
            last_name: 'Okafor',
            present_complaint: 'Headache',
            allergies: ['Penicillin', 'Peanuts'],
            Medical_conditions: ['Hypertension', 'Asthma'],
            timezone: 'Africa/Lagos',
            scheduled_start_local: localIsoAt(slotDay, 10),
            requested_duration_minutes: 30,
            confirm_appointment: true,
        });

        expect(userRepository.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: patientId.toString() },
            {
                $set: {
                    allergies: ['Penicillin', 'Peanuts'],
                    previous_medical_conditions: ['Hypertension', 'Asthma'],
                    timezone: 'Africa/Lagos',
                },
            },
            {},
        );
    });

    it('skips profile reconciliation when booking for someone else', async () => {
        const patientId = new Types.ObjectId();
        const doctorId = new Types.ObjectId();
        const slotDay = futureUtcMonday();
        const start = slotDay.set({ hour: 10 }).toJSDate();
        const end = slotDay.set({ hour: 10, minute: 30 }).toJSDate();

        appointmentsRepository.findOne.mockResolvedValue(null);
        appointmentsRepository.create.mockResolvedValue({ _id: new Types.ObjectId() });

        await (service as any).persistAppointmentAndConsultation(
            patientId.toString(),
            doctorId,
            'UTC',
            start,
            end,
            {
                first_name: 'Child',
                last_name: 'Okafor',
                present_complaint: 'Fever',
                allergies: ['Peanuts'],
                timezone: 'UTC',
                scheduled_start_local: localIsoAt(slotDay, 10),
                requested_duration_minutes: 30,
                confirm_appointment: true,
                appointment_for: AppointmentFor.OTHERS,
            },
        );

        expect(userRepository.findOne).not.toHaveBeenCalled();
        expect(userRepository.findOneAndUpdate).not.toHaveBeenCalled();
        expect(appointmentsRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                appointment_for: AppointmentFor.OTHERS,
            }),
        );
    });

    it('attaches rescheduled history when fetching a patient appointment by id', async () => {
        const patientId = new Types.ObjectId();
        const doctorId = new Types.ObjectId();
        const appointmentId = new Types.ObjectId();
        const oldAppointmentId = new Types.ObjectId();
        const appointmentNumber = 'APT-20260601-1234';
        const oldAppointmentNumber = 'APT-20260530-4321';
        const appointment = {
            _id: appointmentId,
            appointment_number: appointmentNumber,
            patient_id: patientId,
            doctor_id: doctorId,
            status: AppointmentStatus.CONFIRMED,
            rescheduled_from_appointment_id: oldAppointmentId,
        };
        const historyItem = {
            _id: oldAppointmentId,
            appointment_number: oldAppointmentNumber,
            patient_id: patientId,
            doctor_id: doctorId,
            status: AppointmentStatus.RESCHEDULED,
        };
        const findOneLean = jest.fn().mockResolvedValue(appointment);
        const secondPopulate = jest.fn().mockReturnValue({ lean: findOneLean });
        const firstPopulate = jest.fn().mockReturnValue({ populate: secondPopulate });
        const findHistoryLean = jest.fn().mockResolvedValue([historyItem]);
        const historySort = jest.fn().mockReturnValue({ lean: findHistoryLean });
        const thirdHistoryPopulate = jest.fn().mockReturnValue({ sort: historySort });
        const secondHistoryPopulate = jest.fn().mockReturnValue({ populate: thirdHistoryPopulate });
        const firstHistoryPopulate = jest.fn().mockReturnValue({ populate: secondHistoryPopulate });
        const historyFind = jest.fn().mockReturnValue({ populate: firstHistoryPopulate });

        appointmentsRepository.model.mockReturnValue({
            findOne: jest.fn().mockReturnValue({ populate: firstPopulate }),
            find: historyFind,
        });

        const result = await service.getPatientAppointmentById(
            patientId.toString(),
            appointmentId.toString(),
        );

        expect(result).toEqual({
            ...appointment,
            rescheduled_history: [historyItem],
        });
        expect(historyFind).toHaveBeenCalledWith({
            status: AppointmentStatus.RESCHEDULED,
            $or: [
                { appointment_number: { $in: [appointmentNumber] } },
                { _id: { $in: [oldAppointmentId] } },
            ],
        });
        expect(firstHistoryPopulate).toHaveBeenCalledWith({
            path: 'consultation_id',
            select: 'appointment_id type title details status consultation_id createdAt updatedAt',
        });
        expect(secondHistoryPopulate).toHaveBeenCalledWith({
            path: 'doctor_id',
            select: 'first_name last_name full_name email specializations profile_picture_url',
        });
        expect(thirdHistoryPopulate).toHaveBeenCalledWith({
            path: 'patient_id',
            select: 'first_name last_name full_name email gender marital_status occupation profile_picture_url',
        });
    });

    it('excludes completed appointments from patient list', async () => {
        const patientId = new Types.ObjectId();

        const aggregate = jest.fn().mockResolvedValue([]);
        const populate = jest.fn().mockResolvedValue([]);
        const countDocuments = jest.fn().mockResolvedValue(0);

        appointmentsRepository.model.mockReturnValue({
            aggregate,
            populate,
            countDocuments,
        });

        const result = await service.getPatientAppointments(patientId.toString(), {});

        expect(result.items).toEqual([]);
        expect(aggregate).toHaveBeenCalledWith([
            expect.objectContaining({
                $match: expect.objectContaining({
                    status: {
                        $nin: [AppointmentStatus.RESCHEDULED, AppointmentStatus.COMPLETED],
                    },
                }),
            }),
            expect.objectContaining({
                $addFields: expect.objectContaining({
                    is_upcoming: expect.any(Object),
                    time_diff: expect.any(Object),
                }),
            }),
            { $sort: { is_upcoming: 1, time_diff: 1 } },
            expect.any(Object),
            expect.any(Object),
            expect.any(Object),
        ]);
    });

    it('sorts patient appointments with the nearest upcoming date first', () => {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const items = [
            { scheduled_start_at_utc: new Date(now + 11 * day) },
            { scheduled_start_at_utc: new Date(now + 1 * day) },
            { scheduled_start_at_utc: new Date(now + 2 * day) },
            { scheduled_start_at_utc: new Date(now - 3 * day) },
        ];

        const sorted = (service as any).sortAppointmentsByClosestFuture(items);

        expect(sorted.map((item: any) => item.scheduled_start_at_utc.getTime())).toEqual([
            items[1].scheduled_start_at_utc.getTime(),
            items[2].scheduled_start_at_utc.getTime(),
            items[0].scheduled_start_at_utc.getTime(),
            items[3].scheduled_start_at_utc.getTime(),
        ]);
    });

    it('excludes completed appointments from doctor list', async () => {
        const doctorId = new Types.ObjectId();

        const aggregate = jest.fn().mockResolvedValue([]);
        const countDocuments = jest.fn().mockResolvedValue(0);

        appointmentsRepository.model.mockReturnValue({
            aggregate,
            countDocuments,
        });

        const result = await service.getDoctorAppointments(doctorId.toString(), {});

        expect(result.items).toEqual([]);
        expect(aggregate).toHaveBeenCalledWith([
            expect.objectContaining({
                $match: expect.objectContaining({
                    status: {
                        $nin: [AppointmentStatus.RESCHEDULED, AppointmentStatus.COMPLETED],
                    },
                }),
            }),
            expect.any(Object),
            expect.any(Object),
            expect.any(Object),
            expect.any(Object),
            expect.any(Object),
        ]);
    });

    it('attaches rescheduled history when fetching a doctor appointment by id', async () => {
        const patientId = new Types.ObjectId();
        const doctorId = new Types.ObjectId();
        const appointmentId = new Types.ObjectId();
        const appointmentNumber = 'APT-20260601-5678';
        const appointment = {
            _id: appointmentId,
            appointment_number: appointmentNumber,
            patient_id: patientId,
            doctor_id: doctorId,
            status: AppointmentStatus.CONFIRMED,
        };
        const historyItem = {
            _id: new Types.ObjectId(),
            appointment_number: appointmentNumber,
            patient_id: patientId,
            doctor_id: doctorId,
            status: AppointmentStatus.RESCHEDULED,
        };
        const findOneLean = jest.fn().mockResolvedValue(appointment);
        const secondPopulate = jest.fn().mockReturnValue({ lean: findOneLean });
        const firstPopulate = jest.fn().mockReturnValue({ populate: secondPopulate });
        const findHistoryLean = jest.fn().mockResolvedValue([historyItem]);
        const historySort = jest.fn().mockReturnValue({ lean: findHistoryLean });
        const thirdHistoryPopulate = jest.fn().mockReturnValue({ sort: historySort });
        const secondHistoryPopulate = jest.fn().mockReturnValue({ populate: thirdHistoryPopulate });
        const firstHistoryPopulate = jest.fn().mockReturnValue({ populate: secondHistoryPopulate });
        const historyFind = jest.fn().mockReturnValue({ populate: firstHistoryPopulate });

        appointmentsRepository.model.mockReturnValue({
            findOne: jest.fn().mockReturnValue({ populate: firstPopulate }),
            find: historyFind,
        });

        const result = await service.getDoctorAppointmentById(
            doctorId.toString(),
            appointmentId.toString(),
        );

        expect(result).toEqual({
            ...appointment,
            rescheduled_history: [historyItem],
        });
        expect(historyFind).toHaveBeenCalledWith({
            status: AppointmentStatus.RESCHEDULED,
            $or: [
                { appointment_number: { $in: [appointmentNumber] } },
            ],
        });
        expect(firstHistoryPopulate).toHaveBeenCalledWith({
            path: 'consultation_id',
            select: 'appointment_id type title details status consultation_id createdAt updatedAt',
        });
        expect(secondHistoryPopulate).toHaveBeenCalledWith({
            path: 'doctor_id',
            select: 'first_name last_name full_name email specializations profile_picture_url',
        });
        expect(thirdHistoryPopulate).toHaveBeenCalledWith({
            path: 'patient_id',
            select: 'first_name last_name full_name email gender marital_status occupation profile_picture_url',
        });
    });


    // ═══════════════════════════════════════════════════════════════════════
    // getSystemAvailabilityMatrix tests
    // ═══════════════════════════════════════════════════════════════════════

    describe('getSystemAvailabilityMatrix', () => {
        const doctorAvailabilityRepository = {
            findOne: jest.fn(),
            model: jest.fn(),
        };
        const doctorBlackoutRepository = {
            findOne: jest.fn(),
            model: jest.fn(),
        };
        const appointmentsRepository = {
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            create: jest.fn(),
            model: jest.fn(),
        };
        const doctorRepository = {
            findOne: jest.fn(),
            model: jest.fn(),
        };
        const consultationModel = { updateOne: jest.fn() };
        const configService = { get: jest.fn() };
        const userRepository = {
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
        };

        let service: BookingsService;

        beforeEach(() => {
            jest.clearAllMocks();

            service = new BookingsService(
                doctorAvailabilityRepository as any,
                doctorBlackoutRepository as any,
                appointmentsRepository as any,
                doctorRepository as any,
                consultationModel as any,
                configService as any,
                userRepository as any,
                eventEmitter as any,
            );

            // Default: no blackouts
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
        });

        it('returns empty days when no doctors have availability', async () => {
            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({
                startDate: '2026-06-08',
                endDate: '2026-06-10',
                timezone: 'UTC',
            } as any);

            expect(result).toEqual({});
        });

        it('returns 15-minute blocks and max_consecutive_slots=4 for a one-hour free doctor', async () => {
            const docId = new Types.ObjectId().toString();

            // Doctor available every Monday 09:00-10:00 UTC. Matrix still emits 15-minute blocks.
            const availabilities = [
                {
                    doctor_id: new Types.ObjectId(docId),
                    timezone: 'UTC',
                    weekly_slots: [
                        { day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30, is_active: true },
                    ],
                },
            ];

            // Find next Monday (2026-06-08)
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue(availabilities),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId), full_name: 'Dr. A' }]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            expect(result[targetDate]).toBeDefined();
            const slots = result[targetDate].slots;
            expect(slots).toHaveLength(4);
            expect(slots[0].available_doctors).toBe(1);
            expect(slots[0].max_consecutive_slots).toBe(4);
            expect(slots[1].available_doctors).toBe(1);
            expect(slots[1].max_consecutive_slots).toBe(3);
            expect(slots[2].available_doctors).toBe(1);
            expect(slots[2].max_consecutive_slots).toBe(2);
            expect(slots[3].available_doctors).toBe(1);
            expect(slots[3].max_consecutive_slots).toBe(1);
        });

        it('reduces available_doctors to 0 when doctor is booked', async () => {
            const docId = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: [
                                { day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30, is_active: true },
                            ],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId) }]),
                }),
            });
            // Doctor has a booking at 09:00-09:30
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue([
                            {
                                doctor_id: new Types.ObjectId(docId),
                                scheduled_start_at_utc: new Date('2026-06-08T09:00:00.000Z'),
                                scheduled_end_at_utc: new Date('2026-06-08T09:30:00.000Z'),
                            },
                        ]),
                    }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            const slots = result[targetDate].slots;
            // 09:00 and 09:15 are blocked by the 09:00-09:30 appointment.
            expect(slots[0].available_doctors).toBe(0);
            expect(slots[0].max_consecutive_slots).toBe(0);
            expect(slots[1].available_doctors).toBe(0);
            expect(slots[1].max_consecutive_slots).toBe(0);
            // 09:30 onward is still free.
            expect(slots[2].available_doctors).toBe(1);
            expect(slots[2].max_consecutive_slots).toBe(2);
        });

        it('reduces available_doctors to 0 when doctor has a blackout', async () => {
            const docId = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: [
                                { day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30, is_active: true },
                            ],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId) }]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            // Doctor has a blackout covering the 09:30 and 09:45 blocks.
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue([
                            {
                                doctor_id: new Types.ObjectId(docId),
                                start_at_utc: new Date('2026-06-08T09:30:00.000Z'),
                                end_at_utc: new Date('2026-06-08T10:00:00.000Z'),
                                reccuring: false,
                            },
                        ]),
                    }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            const slots = result[targetDate].slots;
            // 09:00 is free
            expect(slots[0].available_doctors).toBe(1);
            expect(slots[1].available_doctors).toBe(1);
            // 09:30 and 09:45 are blocked by blackout.
            expect(slots[2].available_doctors).toBe(0);
            expect(slots[3].available_doctors).toBe(0);
        });

        it('applies recurring blackouts only to the matching doctor', async () => {
            const docA = new Types.ObjectId().toString();
            const docB = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docA),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 15, is_active: true }],
                        },
                        {
                            doctor_id: new Types.ObjectId(docB),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 15, is_active: true }],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        { _id: new Types.ObjectId(docA) },
                        { _id: new Types.ObjectId(docB) },
                    ]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue([
                            {
                                doctor_id: new Types.ObjectId(docA),
                                reccuring: true,
                                timezone: 'UTC',
                                day_of_week: 1,
                                start_time_minutes: 9 * 60,
                                end_time_minutes: 10 * 60,
                            },
                        ]),
                    }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            const slots = result[targetDate].slots;
            expect(slots).toHaveLength(4);
            expect(slots.every((slot: any) => slot.available_doctors === 1)).toBe(true);
            expect(slots[0].max_consecutive_slots).toBe(4);
        });

        it('uses the best individual doctor run for max_consecutive_slots', async () => {
            const emeka = new Types.ObjectId().toString();
            const fatima = new Types.ObjectId().toString();
            const tunde = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(emeka),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 15, is_active: true }],
                        },
                        {
                            doctor_id: new Types.ObjectId(fatima),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '09:30', slot_duration_minutes: 15, is_active: true }],
                        },
                        {
                            doctor_id: new Types.ObjectId(tunde),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '09:15', slot_duration_minutes: 15, is_active: true }],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        { _id: new Types.ObjectId(emeka) },
                        { _id: new Types.ObjectId(fatima) },
                        { _id: new Types.ObjectId(tunde) },
                    ]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            const slots = result[targetDate].slots;
            expect(slots[0]).toEqual({
                time: '09:00 AM',
                available_doctors: 3,
                max_consecutive_slots: 4,
            });
            expect(slots[1]).toEqual({
                time: '09:15 AM',
                available_doctors: 2,
                max_consecutive_slots: 3,
            });
            expect(slots[2]).toEqual({
                time: '09:30 AM',
                available_doctors: 1,
                max_consecutive_slots: 2,
            });
            expect(slots[3]).toEqual({
                time: '09:45 AM',
                available_doctors: 1,
                max_consecutive_slots: 1,
            });
        });

        it('does not combine adjacent slots from different doctors into one consecutive run', async () => {
            const emeka = new Types.ObjectId().toString();
            const fatima = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(emeka),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '11:00', end_time: '11:15', slot_duration_minutes: 15, is_active: true }],
                        },
                        {
                            doctor_id: new Types.ObjectId(fatima),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '11:15', end_time: '11:30', slot_duration_minutes: 15, is_active: true }],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        { _id: new Types.ObjectId(emeka) },
                        { _id: new Types.ObjectId(fatima) },
                    ]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            expect(result[targetDate].slots).toEqual([
                {
                    time: '11:00 AM',
                    available_doctors: 1,
                    max_consecutive_slots: 1,
                },
                {
                    time: '11:15 AM',
                    available_doctors: 1,
                    max_consecutive_slots: 1,
                },
            ]);
        });

        it('counts available_doctors correctly with two doctors, one free and one booked', async () => {
            const docA = new Types.ObjectId().toString();
            const docB = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docA),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30, is_active: true }],
                        },
                        {
                            doctor_id: new Types.ObjectId(docB),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30, is_active: true }],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        { _id: new Types.ObjectId(docA) },
                        { _id: new Types.ObjectId(docB) },
                    ]),
                }),
            });
            // DocB is booked at 09:00
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue([
                            {
                                doctor_id: new Types.ObjectId(docB),
                                scheduled_start_at_utc: new Date('2026-06-08T09:00:00.000Z'),
                                scheduled_end_at_utc: new Date('2026-06-08T09:30:00.000Z'),
                            },
                        ]),
                    }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            const slots = result[targetDate].slots;
            // 09:00 and 09:15: docA free, docB booked → 1
            expect(slots[0].available_doctors).toBe(1);
            expect(slots[1].available_doctors).toBe(1);
            // 09:30 and 09:45: both free → 2
            expect(slots[2].available_doctors).toBe(2);
            expect(slots[3].available_doctors).toBe(2);
        });

        it('returns 15-minute max_consecutive_slots for a doctor blocked near the end', async () => {
            const docId = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            // The matrix should emit 15-minute blocks regardless of slot_duration_minutes.
            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: [
                                { day_of_week: 1, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30, is_active: true },
                            ],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId) }]),
                }),
            });
            // Doctor is booked at 10:30 (slot 3, the 4th slot)
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue([
                            {
                                doctor_id: new Types.ObjectId(docId),
                                scheduled_start_at_utc: new Date('2026-06-08T10:30:00.000Z'),
                                scheduled_end_at_utc: new Date('2026-06-08T11:00:00.000Z'),
                            },
                        ]),
                    }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            const slots = result[targetDate].slots;
            expect(slots).toHaveLength(8);
            // Doctor is free from 09:00-10:30 (6 blocks), but the exposed value is capped at 4.
            expect(slots[0].available_doctors).toBe(1);
            expect(slots[0].max_consecutive_slots).toBe(4);
            expect(slots[1].available_doctors).toBe(1);
            expect(slots[1].max_consecutive_slots).toBe(4);
            expect(slots[4].available_doctors).toBe(1);
            expect(slots[4].max_consecutive_slots).toBe(2);
            expect(slots[5].available_doctors).toBe(1);
            expect(slots[5].max_consecutive_slots).toBe(1);
            // 10:30 and 10:45 are blocked by appointment.
            expect(slots[6].available_doctors).toBe(0);
            expect(slots[6].max_consecutive_slots).toBe(0);
            expect(slots[7].available_doctors).toBe(0);
            expect(slots[7].max_consecutive_slots).toBe(0);
        });

        it('caps max_consecutive_slots at 4 for long 15-minute availability windows', async () => {
            const docId = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: [
                                { day_of_week: 1, start_time: '00:00', end_time: '23:45', slot_duration_minutes: 15, is_active: true },
                            ],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId) }]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            expect(result[targetDate].slots[0].max_consecutive_slots).toBe(4);
            expect(Math.max(...result[targetDate].slots.map((slot: any) => slot.max_consecutive_slots))).toBe(4);
        });

        it('excludes a doctor whose effective_from is after the query range', async () => {
            const docId = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: [
                                { day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30, is_active: true },
                            ],
                            effective_from: new Date('2026-07-01'), // Starts in July
                            effective_to: undefined,
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId), active: true }]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ startDate: targetDate, endDate: targetDate, timezone: 'UTC' } as any);

            // Doctor's effective range starts July — June slot should be excluded
            expect(result[targetDate]).toBeUndefined();
        });

        it('formats response days and slot times in the requested timezone', async () => {
            const docId = new Types.ObjectId().toString();
            const targetDate = '2026-06-08';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30, is_active: true }],
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId) }]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({
                startDate: targetDate,
                endDate: targetDate,
                timezone: 'America/Edmonton',
            } as any);

            expect(result[targetDate]).toBeDefined();
            expect(result[targetDate].slots[0].time).toBe('03:00 AM');
        });

        it('supports days_ahead starting from today UTC', async () => {
            const docId = new Types.ObjectId().toString();
            const todayUtc = DateTime.utc().toISODate() ?? '';
            const expectedTo = DateTime.fromISO(todayUtc, { zone: 'UTC' })
                .plus({ days: 2 })
                .toISODate() ?? '';

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: Array.from({ length: 7 }, (_, day_of_week) => ({
                                day_of_week,
                                start_time: '09:00',
                                end_time: '09:30',
                                slot_duration_minutes: 30,
                                is_active: true,
                            })),
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId) }]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({ days_ahead: 3, timezone: 'UTC' } as any);

            expect(Object.keys(result)).toEqual([
                todayUtc,
                DateTime.fromISO(todayUtc, { zone: 'UTC' }).plus({ days: 1 }).toISODate(),
                expectedTo,
            ]);
        });

        it('defaults to the next 14 days when no range is supplied', async () => {
            const docId = new Types.ObjectId().toString();
            const todayUtc = DateTime.utc().toISODate() ?? '';
            const expectedLastDate = DateTime.fromISO(todayUtc, { zone: 'UTC' })
                .plus({ days: 13 })
                .toISODate();

            doctorAvailabilityRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([
                        {
                            doctor_id: new Types.ObjectId(docId),
                            timezone: 'UTC',
                            weekly_slots: Array.from({ length: 7 }, (_, day_of_week) => ({
                                day_of_week,
                                start_time: '09:00',
                                end_time: '09:30',
                                slot_duration_minutes: 30,
                                is_active: true,
                            })),
                        },
                    ]),
                }),
            });
            doctorRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(docId) }]),
                }),
            });
            appointmentsRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });
            doctorBlackoutRepository.model.mockReturnValue({
                find: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
                }),
            });

            const result = await service.getSystemAvailabilityMatrix({} as any);
            const dates = Object.keys(result);

            expect(dates).toHaveLength(14);
            expect(dates[0]).toBe(todayUtc);
            expect(dates[13]).toBe(expectedLastDate);
        });
    });
});

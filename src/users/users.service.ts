import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoreService } from 'src/common/core/service.core';
import { UserRepository } from './user.repository';
import { UpdatePatientProfileDto } from './dto/update-user-profile.dto';
import { AppointmentStatus } from 'src/common/enums';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { ConsultationStatusEnum } from 'src/consultations/consultations.enums';
import {
    ConsultationDocument,
    InvestigationDocument,
    InvestigationListDocument,
} from 'src/consultations/consultations.model';

@Injectable()
export class UsersService extends CoreService<UserRepository> {
    constructor(
        private readonly userRepository: UserRepository,
        @InjectModel('Consultation')
        private readonly consultationModel: Model<ConsultationDocument>,
        @InjectModel('Investigation')
        private readonly investigationModel: Model<InvestigationDocument>,
        @InjectModel('InvestigationList')
        private readonly investigationListModel: Model<InvestigationListDocument>,
        @InjectModel('Appointment')
        private readonly appointmentModel: Model<AppointmentDocument>,
    ) {
        super(userRepository)
    }

    async getUser(user_id: string) {
        const user = await this.userRepository.findOne({ _id: user_id })
        if (!user) throw new NotFoundException('Patient not found');
        return user
    }

    async getUserSummary(user_id: string) {
        const user = await this.getUser(user_id);

        return {
            _id: user._id,
            registration_no: user.registration_no,
            mrn: user.mrn ?? null,
            first_name: user.first_name,
            last_name: user.last_name,
            full_name: user.full_name,
            email: user.email,
            phone_number: user.phone_number,
            verified: user.verified,
            profile_picture_url: user.profile_picture_url ?? null,
            date_of_birth: user.date_of_birth ?? null,
            gender: user.gender ?? null,
            occupation: user.occupation ?? null,
            marital_status: user.marital_status ?? null,
            timezone: user.timezone ?? null,
        };
    }

    async updateProfile(user_id: string, payload: UpdatePatientProfileDto) {
        const fullName = this.buildFullName(
            payload.first_name,
            payload.last_name,
            payload.middle_name,
        );
        const user = await this.userRepository.findOneAndUpdate(
            { _id: user_id },
            {
                $set: {
                    ...payload,
                    ...(fullName ? { full_name: fullName } : {}),
                },
            },
            {},
        );
        if (!user) throw new NotFoundException('Patient not found');
        return user;
    }

    async updateTimezone(user_id: string, timezone: string) {
        const user = await this.userRepository.findOne({ _id: user_id });
        if (!user) throw new NotFoundException('Patient not found');

        return this.userRepository.findOneAndUpdate(
            { _id: user_id },
            { $set: { timezone } },
            { new: true },
        );
    }

    async getPatientMetrics(user_id: string) {
        const userObjectId = new Types.ObjectId(user_id);
        const now = new Date();
        const activeConsultationFilter = {
            user_id: userObjectId,
            status: {
                $nin: [
                    ConsultationStatusEnum.COMPLETED,
                    ConsultationStatusEnum.CANCELED,
                ],
            },
        };

        const [
            [consultationMetrics],
            legacyInvestigations,
            investigationListItems,
            appointments,
        ] = await Promise.all([
            this.consultationModel.aggregate([
                { $match: activeConsultationFilter },
                {
                    $facet: {
                        consultations: [{ $count: 'total' }],
                        medications: [
                            {
                                $lookup: {
                                    from: 'medications',
                                    localField: '_id',
                                    foreignField: 'consultation_id',
                                    as: 'meds',
                                },
                            },
                            { $unwind: '$meds' },
                            { $match: { 'meds.user_id': userObjectId } },
                            { $count: 'total' },
                        ],
                    },
                },
            ]),
            this.investigationModel.countDocuments({
                user_id: userObjectId,
                file: { $in: [null, ''] },
            }),
            this.investigationListModel.countDocuments({
                user_id: userObjectId,
                assign_to_patient: true,
                'result_images.0': { $exists: false },
            }),
            this.appointmentModel.countDocuments({
                patient_id: userObjectId,
                status: {
                    $in: [
                        AppointmentStatus.PENDING,
                        AppointmentStatus.CONFIRMED,
                    ],
                },
                scheduled_start_at_utc: { $gte: now },
            }),
        ]);

        return {
            consultations: consultationMetrics?.consultations[0]?.total ?? 0,
            medications: consultationMetrics?.medications[0]?.total ?? 0,
            investigations: legacyInvestigations + investigationListItems,
            appointments,
        };
    }

    async updateProfilePicture(user_id: string, profile_picture_url: string) {
        const user = await this.userRepository.findOneAndUpdate(
            { _id: user_id },
            { $set: { profile_picture_url } },
            {},
        );
        if (!user) throw new NotFoundException('Patient not found');
        return user;
    }

    async getPatientById(user_id: string) {
        return this.getUser(user_id);
    }

    async getAllPatients(page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [patients, total] = await Promise.all([
            this.userRepository
                .model()
                .find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            this.userRepository.model().countDocuments(),
        ]);

        return {
            patients,
            pagination: {
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
            },
        };
    }

    async searchPatients(query: string) {
        const q = (query || '').trim();
        if (!q) return [];

        const dateMatch = new Date(q);
        const isValidDate = !isNaN(dateMatch.getTime());

        const filters: Record<string, any>[] = [
            { registration_no: { $regex: q, $options: 'i' } },
            { first_name: { $regex: q, $options: 'i' } },
            { last_name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
        ];

        if (isValidDate) {
            const start = new Date(dateMatch);
            start.setHours(0, 0, 0, 0);
            const end = new Date(dateMatch);
            end.setHours(23, 59, 59, 999);
            filters.push({ date_of_birth: { $gte: start, $lte: end } });
        }

        return this.userRepository
            .model()
            .find({ $or: filters })
            .limit(50)
            .sort({ createdAt: -1 });
    }

    async getPatientsWithSearch(q: string, page = 1, limit = 20, doctor_id?: string) {
        const query = (q || '').trim();
        const skip = (page - 1) * limit;

        let filter: Record<string, any> = {};
        if (query) {
            const dateMatch = new Date(query);
            const isValidDate = !isNaN(dateMatch.getTime());

            const orFilters: Record<string, any>[] = [
                { registration_no: { $regex: query, $options: 'i' } },
                { first_name: { $regex: query, $options: 'i' } },
                { last_name: { $regex: query, $options: 'i' } },
                { full_name: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { phone_number: { $regex: query, $options: 'i' } },
            ];

            if (isValidDate) {
                const start = new Date(dateMatch);
                start.setHours(0, 0, 0, 0);
                const end = new Date(dateMatch);
                end.setHours(23, 59, 59, 999);
                orFilters.push({ date_of_birth: { $gte: start, $lte: end } });
            }

            filter = { $or: orFilters };
        }

        const [patients, total] = await Promise.all([
            this.userRepository.model().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            this.userRepository.model().countDocuments(filter),
        ]);

        // Attach latest consultation_id to each patient
        const patientIds = patients.map((p) => p._id);
        const [latestConsultations, doctorConsultationPatients] = await Promise.all([
            this.consultationModel
                .find({ user_id: { $in: patientIds } })
                .sort({ createdAt: -1 })
                .select('user_id _id')
                .exec(),
            doctor_id
                ? this.consultationModel
                    .find({
                        user_id: { $in: patientIds },
                        doctor_id: new Types.ObjectId(doctor_id),
                    })
                    .select('user_id')
                    .exec()
                : Promise.resolve([]),
        ]);

        // Keep only the most recent per patient
        const latestByPatient = new Map<string, string>();
        for (const c of latestConsultations) {
            const uid = c.user_id.toString();
            if (!latestByPatient.has(uid)) latestByPatient.set(uid, c._id.toString());
        }

        const doctorConsultationSet = new Set(
            doctorConsultationPatients.map((c) => c.user_id.toString()),
        );

        const patientsWithConsultation = patients.map((p) => ({
            ...p.toObject(),
            consultation_id: latestByPatient.get(p._id.toString()) ?? null,
            has_consultation_with_doctor: doctor_id
                ? doctorConsultationSet.has(p._id.toString())
                : false,
        }));

        return {
            patients: patientsWithConsultation,
            pagination: {
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
            },
        };
    }

    private buildFullName(first?: string, last?: string, middle?: string) {
        const parts = [first, middle, last]
            .map((p) => (p || '').trim())
            .filter(Boolean);
        return parts.length ? parts.join(' ') : undefined;
    }

}

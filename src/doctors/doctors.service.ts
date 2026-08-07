import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoreService } from 'src/common/core/service.core';
import { DoctorRepository } from './doctors.repository';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { AppointmentStatus } from 'src/common/enums';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { ConsultationStatusEnum } from 'src/consultations/consultations.enums';
import {
    ConsultationDocument,
    InvestigationDocument,
    InvestigationListDocument,
    MedicationDocument,
} from 'src/consultations/consultations.model';

/**
 * DoctorsService — handles doctor profile operations.
 *
 * Auth logic (signup/login/token generation) has been moved to AuthService.
 * This service now only handles profile management and doctor-specific operations.
 */
@Injectable()
export class DoctorsService extends CoreService<DoctorRepository> {
    private readonly logger = new Logger(DoctorsService.name);

    constructor(
        private readonly doctorRepository: DoctorRepository,
        @InjectModel('Consultation')
        private readonly consultationModel: Model<ConsultationDocument>,
        @InjectModel('Medication')
        private readonly medicationModel: Model<MedicationDocument>,
        @InjectModel('Investigation')
        private readonly investigationModel: Model<InvestigationDocument>,
        @InjectModel('InvestigationList')
        private readonly investigationListModel: Model<InvestigationListDocument>,
        @InjectModel('Appointment')
        private readonly appointmentModel: Model<AppointmentDocument>,
    ) {
        super(doctorRepository);
    }

    async getDoctor(doctorId: string) {
        const doctor = await this.doctorRepository.findOne({ _id: doctorId });
        if (!doctor) throw new NotFoundException('Doctor not found');
        return doctor;
    }

    async getDoctorSummary(doctorId: string) {
        const doctor = await this.getDoctor(doctorId);

        return {
            _id: doctor._id,
            doctor_no: doctor.doctor_no,
            first_name: doctor.first_name,
            last_name: doctor.last_name,
            full_name: doctor.full_name,
            email: doctor.email,
            phone_number: doctor.phone_number,
            active: doctor.active,
            specializations: doctor.specializations,
            profile_picture_url: doctor.profile_picture_url ?? null,
            timezone: doctor.timezone ?? null,
        };
    }

    async updateProfile(doctorId: string, payload: UpdateDoctorProfileDto) {
        const fullName = this.buildFullName(payload.first_name, payload.last_name);
        const doctor = await this.doctorRepository.findOneAndUpdate(
            { _id: doctorId },
            {
                $set: {
                    ...payload,
                    ...(fullName ? { full_name: fullName } : {}),
                },
            },
            {},
        );
        if (!doctor) throw new NotFoundException('Doctor not found');
        return doctor;
    }

    async updateProfilePicture(doctorId: string, profile_picture_url: string) {
        const doctor = await this.doctorRepository.findOneAndUpdate(
            { _id: doctorId },
            { $set: { profile_picture_url } },
            {},
        );
        if (!doctor) throw new NotFoundException('Doctor not found');
        return doctor;
    }

    async updateTimezone(doctorId: string, timezone: string) {
        const doctor = await this.doctorRepository.findOne({ _id: doctorId });
        if (!doctor) throw new NotFoundException('Doctor not found');

        return this.doctorRepository.findOneAndUpdate(
            { _id: doctorId },
            { $set: { timezone } },
            { new: true },
        );
    }

    async getDoctorMetrics(doctorId: string) {
        const doctorObjectId = new Types.ObjectId(doctorId);
        const now = new Date();
        const activeConsultationFilter = {
            doctor_id: doctorObjectId,
            status: {
                $nin: [
                    ConsultationStatusEnum.COMPLETED,
                    ConsultationStatusEnum.CANCELED,
                ],
            },
        };
        const pendingMedicationFilter = {
            doctor_id: doctorObjectId,
            assign_to_patient: { $ne: true },
        };

        const [
            [consultationMetrics],
            [medicationMetrics],
            legacyInvestigationConsultations,
            investigationListConsultations,
            appointments,
        ] = await Promise.all([
            this.consultationModel.aggregate([
                { $match: activeConsultationFilter },
                { $count: 'total' },
            ]),
            this.medicationModel.aggregate([
                { $match: pendingMedicationFilter },
                { $group: { _id: '$consultation_id' } },
                { $count: 'total' },
            ]),
            this.investigationModel.aggregate([
                {
                    $match: {
                        doctor_id: doctorObjectId,
                        status: ConsultationStatusEnum.PENDING,
                    },
                },
                { $group: { _id: '$consultation_id' } },
            ]),
            this.investigationListModel.aggregate([
                {
                    $match: {
                        doctor_id: doctorObjectId,
                        assign_to_patient: { $ne: true },
                    },
                },
                { $group: { _id: '$consultation_id' } },
            ]),
            this.appointmentModel.countDocuments({
                doctor_id: doctorObjectId,
                status: {
                    $in: [
                        AppointmentStatus.PENDING,
                        AppointmentStatus.CONFIRMED,
                    ],
                },
                scheduled_start_at_utc: { $gte: now },
            }),
        ]);

        const investigations = new Set([
            ...legacyInvestigationConsultations.map((row) => String(row._id)),
            ...investigationListConsultations.map((row) => String(row._id)),
        ]).size;

        return {
            consultations: consultationMetrics?.total ?? 0,
            medications: medicationMetrics?.total ?? 0,
            investigations,
            appointments,
        };
    }

    async deactivate(id: string) {
        const doctor = await this.doctorRepository.findOneAndUpdate(
            { _id: id },
            { $set: { refresh_token_hash: null, active: false } },
            { new: true },
        );
        if (!doctor) {
            throw new NotFoundException(`Doctor with ID ${id} not found`);
        }
        return doctor;
    }

    async activate(id: string) {
        const doctor = await this.doctorRepository.findOneAndUpdate(
            { _id: id },
            { $set: { active: true } },
            { new: true },
        );
        if (!doctor) {
            throw new NotFoundException(`Doctor with ID ${id} not found`);
        }
        return doctor;
    }

    private buildFullName(first?: string, last?: string) {
        const parts = [first, last].map((p) => (p || '').trim()).filter(Boolean);
        return parts.length ? parts.join(' ') : undefined;
    }
}

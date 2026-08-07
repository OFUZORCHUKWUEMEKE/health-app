import {
    Injectable,
    BadRequestException,
    InternalServerErrorException,
    Logger,
    ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios, { AxiosInstance } from 'axios';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { ConsultationDocument } from 'src/consultations/consultations.model';
import { AppointmentStatus } from 'src/common/enums';
import { ConsultationStatusEnum, ConsultationTypeEnum, ConsultationForEnum } from 'src/consultations/consultations.enums';

export interface VideoTokenResponse {
    appointmentId: string;
    consultationId: string | null;
    role: 'doctor' | 'patient';
    roomUrl: string;
    token: string;
    expiresAt: string;
}

const EARLY_JOIN_GRACE_MS = 10 * 60 * 1000;

@Injectable()
export class VideoService {
    private readonly api: AxiosInstance;
    private readonly logger = new Logger(VideoService.name);

    constructor(
        private readonly config: ConfigService,
        @InjectModel('Appointment')
        private readonly appointmentModel: Model<AppointmentDocument>,
        @InjectModel('Consultation')
        private readonly consultationModel: Model<ConsultationDocument>,
    ) {
        this.api = axios.create({
            baseURL: 'https://api.daily.co/v1',
            headers: {
                Authorization: `Bearer ${this.config.get<string>('daily.api_key')}`,
                'Content-Type': 'application/json',
            },
            timeout: 10_000,
        });
    }

    async getDoctorVideoToken(
        appointmentId: string,
        doctor: { _id: Types.ObjectId; full_name: string },
    ): Promise<VideoTokenResponse> {
        const appointment = await this.appointmentModel.findById(appointmentId);

        if (!appointment) {
            throw new BadRequestException('Appointment not found');
        }

        if (appointment.doctor_id?.toString() !== doctor._id.toString()) {
            throw new ForbiddenException('This appointment does not belong to you');
        }

        if (appointment.status !== AppointmentStatus.CONFIRMED) {
            throw new BadRequestException(
                'Video is only available for confirmed appointments',
            );
        }

        this.assertWithinAppointmentWindow(appointment);

        // Find or create the consultation before touching Daily.co
        const consultation = await this.consultationModel.findOneAndUpdate(
            { appointment_id: appointment._id },
            {
                $setOnInsert: {
                    appointment_id: appointment._id,
                    doctor_id: appointment.doctor_id,
                    user_id: appointment.patient_id,
                    type: ConsultationTypeEnum.VIDEO,
                    consoltation_for: ConsultationForEnum.SELF,
                    title: 'Video Consultation',
                    status: ConsultationStatusEnum.ACTIVE,
                },
            },
            { upsert: true, new: true, select: '_id' },
        );

        if (!appointment.daily_room_name) {
            await this.createRoomForAppointment(appointment);
        }

        const expiresAt = appointment.daily_room_expires_at ?? appointment.scheduled_end_at_utc;
        const exp = Math.floor(expiresAt.getTime() / 1000);

        const token = await this.createMeetingToken({
            roomName: appointment.daily_room_name,
            isOwner: true,
            userName: doctor.full_name,
            userId: doctor._id.toString(),
            exp,
        });

        return {
            appointmentId: appointment._id.toString(),
            consultationId: consultation._id.toString(),
            role: 'doctor' as const,
            roomUrl: appointment.daily_room_url,
            token,
            expiresAt: expiresAt.toISOString(),
        };
    }

    async getPatientVideoToken(
        appointmentId: string,
        patient: { _id: Types.ObjectId; full_name: string },
    ): Promise<VideoTokenResponse> {
        const appointment = await this.appointmentModel.findById(appointmentId);

        if (!appointment) {
            throw new BadRequestException('Appointment not found');
        }

        if (appointment.patient_id?.toString() !== patient._id.toString()) {
            throw new ForbiddenException('This appointment does not belong to you');
        }

        if (appointment.status !== AppointmentStatus.CONFIRMED) {
            throw new BadRequestException(
                'Video is only available for confirmed appointments',
            );
        }

        this.assertWithinAppointmentWindow(appointment);

        if (!appointment.daily_room_name) {
            throw new BadRequestException(
                "Doctor hasn't opened the session yet. Please wait.",
            );
        }

        const expiresAt = appointment.daily_room_expires_at ?? appointment.scheduled_end_at_utc;
        const exp = Math.floor(expiresAt.getTime() / 1000);

        const token = await this.createMeetingToken({
            roomName: appointment.daily_room_name,
            isOwner: false,
            userName: patient.full_name,
            userId: patient._id.toString(),
            exp,
        });

        const consultation = await this.consultationModel.findOne(
            { appointment_id: appointment._id },
            { _id: 1 },
        );

        return {
            appointmentId: appointment._id.toString(),
            consultationId: consultation?._id?.toString() ?? null,
            role: 'patient' as const,
            roomUrl: appointment.daily_room_url,
            token,
            expiresAt: expiresAt.toISOString(),
        };
    }

    // Called by doctor's app when the call starts
    async markSessionStarted(
        appointmentId: string,
        doctorId: Types.ObjectId,
    ): Promise<void> {
        const appointment = await this.appointmentModel.findById(appointmentId);

        if (!appointment) throw new BadRequestException('Appointment not found');
        if (appointment.doctor_id?.toString() !== doctorId.toString()) {
            throw new ForbiddenException('This appointment does not belong to you');
        }

        this.assertWithinAppointmentWindow(appointment);

        await this.consultationModel.findOneAndUpdate(
            { appointment_id: appointment._id },
            { $set: { status: ConsultationStatusEnum.ACTIVE } },
        );
    }

    // Called by doctor's app when the call ends. Does NOT complete the
    // consultation — the doctor must explicitly hit the complete endpoint.
    async markSessionEnded(
        appointmentId: string,
        doctorId: Types.ObjectId,
    ): Promise<void> {
        const appointment = await this.appointmentModel.findById(appointmentId);

        if (!appointment) throw new BadRequestException('Appointment not found');
        if (appointment.doctor_id?.toString() !== doctorId.toString()) {
            throw new ForbiddenException('This appointment does not belong to you');
        }
    }

    // ---------- private helpers ----------

    private assertWithinAppointmentWindow(appointment: AppointmentDocument): void {
        const now = Date.now();
        const start = appointment.scheduled_start_at_utc.getTime();
        const end = appointment.scheduled_end_at_utc.getTime();

        if (now < start - EARLY_JOIN_GRACE_MS) {
            throw new BadRequestException(
                `Video session can only be started at the scheduled time (${appointment.scheduled_start_at_utc.toISOString()}).`,
            );
        }

        if (now > end) {
            throw new BadRequestException(
                'This appointment window has already ended.',
            );
        }
    }

    private async createRoomForAppointment(
        appointment: AppointmentDocument,
    ): Promise<void> {
        const nbf =
            Math.floor(appointment.scheduled_start_at_utc.getTime() / 1000) - 600;
        const exp =
            Math.floor(appointment.scheduled_end_at_utc.getTime() / 1000) + 1800;

        const roomName = `consultation-${appointment._id.toString()}`;

        try {
            const { data } = await this.api.post('/rooms', {
                name: roomName,
                privacy: 'private',
                properties: {
                    nbf,
                    exp,
                    max_participants: 2,
                    enable_knocking: false,
                },
            });

            await this.appointmentModel.findByIdAndUpdate(appointment._id, {
                $set: {
                    daily_room_name: data.name,
                    daily_room_url: data.url,
                    daily_room_expires_at: new Date(exp * 1000),
                },
            });

            appointment.daily_room_name = data.name;
            appointment.daily_room_url = data.url;
            appointment.daily_room_expires_at = new Date(exp * 1000);
        } catch (err) {
            this.logger.error('Failed to create Daily room', err?.response?.data ?? err);
            throw new InternalServerErrorException('Failed to create video room');
        }
    }

    private async createMeetingToken(opts: {
        roomName: string;
        isOwner: boolean;
        userName: string;
        userId: string;
        exp: number;
    }): Promise<string> {
        try {
            const { data } = await this.api.post('/meeting-tokens', {
                properties: {
                    room_name: opts.roomName,
                    is_owner: opts.isOwner,
                    user_name: opts.userName,
                    user_id: opts.userId,
                    exp: opts.exp,
                    eject_at_token_exp: true,
                },
            });

            return data.token as string;
        } catch (err) {
            this.logger.error('Failed to create meeting token', err?.response?.data ?? err);
            throw new InternalServerErrorException('Failed to generate video token');
        }
    }
}

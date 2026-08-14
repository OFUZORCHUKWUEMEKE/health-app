import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import axios, { AxiosInstance } from 'axios';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { ConsultationDocument } from 'src/consultations/consultations.model';
import { AppointmentStatus } from 'src/common/enums';
import {
  ConsultationStatusEnum,
  ConsultationTypeEnum,
  ConsultationForEnum,
} from 'src/consultations/consultations.enums';

export interface VideoTokenResponse {
  appointmentId: string;
  consultationId: string | null;
  role: 'doctor' | 'patient';
  roomUrl: string;
  token: string;
  expiresAt: string;
}

/**
 * `full_name` is an optional field that is only populated when a user edits
 * their profile, so it cannot be relied on for the Daily display name.
 */
export interface VideoParticipant {
  _id: Types.ObjectId;
  full_name?: string;
  first_name?: string;
  last_name?: string;
}

const EARLY_JOIN_GRACE_MS = 10 * 60 * 1000;

// Daily caps meeting-token `user_id` at 36 characters.
const DAILY_MAX_USER_ID_LENGTH = 36;

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
    doctor: VideoParticipant,
  ): Promise<VideoTokenResponse> {
    const appointment = await this.findAppointmentOrFail(appointmentId);

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

    // Keep the reverse link in sync — bookings queries populate
    // `appointment.consultation_id`, which is null without this.
    if (
      appointment.consultation_id?.toString() !== consultation._id.toString()
    ) {
      await this.appointmentModel.updateOne(
        { _id: appointment._id },
        { $set: { consultation_id: consultation._id } },
      );
      appointment.consultation_id = consultation._id as any;
    }

    if (!appointment.daily_room_name) {
      await this.createRoomForAppointment(appointment);
    }

    const expiresAt =
      appointment.daily_room_expires_at ?? appointment.scheduled_end_at_utc;
    const exp = Math.floor(expiresAt.getTime() / 1000);

    const token = await this.createMeetingToken({
      roomName: appointment.daily_room_name,
      isOwner: true,
      userName: this.resolveDisplayName(doctor, 'Doctor'),
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
    patient: VideoParticipant,
  ): Promise<VideoTokenResponse> {
    const appointment = await this.findAppointmentOrFail(appointmentId);

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

    const expiresAt =
      appointment.daily_room_expires_at ?? appointment.scheduled_end_at_utc;
    const exp = Math.floor(expiresAt.getTime() / 1000);

    const token = await this.createMeetingToken({
      roomName: appointment.daily_room_name,
      isOwner: false,
      userName: this.resolveDisplayName(patient, 'Patient'),
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
    const appointment = await this.findAppointmentOrFail(appointmentId);

    if (appointment.doctor_id?.toString() !== doctorId.toString()) {
      throw new ForbiddenException('This appointment does not belong to you');
    }

    this.assertWithinAppointmentWindow(appointment);

    const consultation = await this.consultationModel.findOneAndUpdate(
      { appointment_id: appointment._id },
      { $set: { status: ConsultationStatusEnum.ACTIVE } },
      { new: true, select: '_id' },
    );

    // Without a consultation there is nothing to activate — the doctor has
    // not fetched a video token yet, so fail loudly instead of no-opping.
    if (!consultation) {
      throw new BadRequestException(
        'No consultation exists for this appointment yet. Request a video token first.',
      );
    }

    // Only record the first join so re-joins don't overwrite the start time.
    await this.appointmentModel.updateOne(
      { _id: appointment._id, video_started_at: { $exists: false } },
      { $set: { video_started_at: new Date() } },
    );
  }

  // Called by doctor's app when the call ends. Does NOT complete the
  // consultation — the doctor must explicitly hit the complete endpoint.
  async markSessionEnded(
    appointmentId: string,
    doctorId: Types.ObjectId,
  ): Promise<void> {
    const appointment = await this.findAppointmentOrFail(appointmentId);

    if (appointment.doctor_id?.toString() !== doctorId.toString()) {
      throw new ForbiddenException('This appointment does not belong to you');
    }

    // Records when the doctor left. The consultation intentionally stays
    // ACTIVE — completing it is a separate, explicit doctor action.
    await this.appointmentModel.updateOne(
      { _id: appointment._id },
      { $set: { video_ended_at: new Date() } },
    );
  }

  // ---------- private helpers ----------

  /**
   * Rejects malformed ids up front — `findById` would otherwise throw a
   * Mongoose CastError, which no exception filter catches, surfacing as a 500.
   */
  private async findAppointmentOrFail(
    appointmentId: string,
  ): Promise<AppointmentDocument> {
    if (!isValidObjectId(appointmentId)) {
      throw new BadRequestException('Invalid appointment id');
    }

    const appointment = await this.appointmentModel.findById(appointmentId);

    if (!appointment) {
      throw new BadRequestException('Appointment not found');
    }

    return appointment;
  }

  private resolveDisplayName(
    participant: VideoParticipant,
    fallback: string,
  ): string {
    const name =
      participant.full_name?.trim() ||
      [participant.first_name, participant.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();

    return name || fallback;
  }

  private assertWithinAppointmentWindow(
    appointment: AppointmentDocument,
  ): void {
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

    let room: { name: string; url: string; config?: { exp?: number } };

    try {
      const { data } = await this.api.post('/rooms', {
        name: roomName,
        privacy: 'private',
        properties: {
          nbf,
          exp,
          max_participants: 2,
          enable_knocking: false,
          // End the call if it is still running at room expiry.
          eject_at_room_exp: true,
        },
      });
      room = data;
    } catch (err) {
      // Room names are deterministic, so a previous attempt may have
      // created the room on Daily before we managed to persist it. Daily
      // answers 400 `invalid-request-error` / "a room named X already
      // exists" — adopt that room instead of failing forever.
      if (this.isRoomAlreadyExistsError(err)) {
        this.logger.warn(`Daily room ${roomName} already exists — adopting it`);
        room = await this.fetchExistingRoom(roomName);
      } else {
        this.logger.error(
          'Failed to create Daily room',
          err?.response?.data ?? err,
        );
        throw new InternalServerErrorException('Failed to create video room');
      }
    }

    // Trust the room's own expiry when adopting a pre-existing room.
    const expiresAt = new Date((room.config?.exp ?? exp) * 1000);

    await this.appointmentModel.updateOne(
      { _id: appointment._id },
      {
        $set: {
          daily_room_name: room.name,
          daily_room_url: room.url,
          daily_room_expires_at: expiresAt,
        },
      },
    );

    appointment.daily_room_name = room.name;
    appointment.daily_room_url = room.url;
    appointment.daily_room_expires_at = expiresAt;
  }

  private isRoomAlreadyExistsError(err: any): boolean {
    return (
      err?.response?.status === 400 &&
      typeof err?.response?.data?.info === 'string' &&
      err.response.data.info.includes('already exists')
    );
  }

  private async fetchExistingRoom(
    roomName: string,
  ): Promise<{ name: string; url: string; config?: { exp?: number } }> {
    try {
      const { data } = await this.api.get(
        `/rooms/${encodeURIComponent(roomName)}`,
      );
      return data;
    } catch (err) {
      this.logger.error(
        `Failed to fetch existing Daily room ${roomName}`,
        err?.response?.data ?? err,
      );
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
          user_id: opts.userId.slice(0, DAILY_MAX_USER_ID_LENGTH),
          exp: opts.exp,
          eject_at_token_exp: true,
        },
      });

      return data.token as string;
    } catch (err) {
      this.logger.error(
        'Failed to create meeting token',
        err?.response?.data ?? err,
      );
      throw new InternalServerErrorException('Failed to generate video token');
    }
  }
}

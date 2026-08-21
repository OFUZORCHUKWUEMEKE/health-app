import {
  Injectable,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import axios, { AxiosInstance } from 'axios';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { ConsultationDocument } from 'src/consultations/consultations.model';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppointmentFor, AppointmentStatus } from 'src/common/enums';
import { AppEvents, VideoRoomOpenedEvent } from 'src/common/events';
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

/**
 * How early a participant may be admitted. Two different gates enforce it and they must
 * agree: this one rejects the API call, and the Daily room's own `nbf` rejects the join.
 * `createRoomForAppointment` derives `nbf` from this constant rather than repeating the
 * number — when they drifted apart the symptom was a caller the API admitted and Daily
 * then refused, which looks like a client bug from every angle except this one.
 */
const EARLY_JOIN_GRACE_MS = 10 * 60 * 1000;

/**
 * How long the room outlives the appointment. Deliberately asymmetric with
 * EARLY_JOIN_GRACE_MS, because the two constants answer different questions:
 * `assertWithinAppointmentWindow` governs whether a call may *start*, while this governs
 * how long one already running may *finish*. A consultation that runs past its slot should
 * not be cut off mid-sentence, but it also must not be joinable an hour later — hence a
 * generous room tail and a hard window on new joins.
 */
const ROOM_OVERRUN_MS = 30 * 60 * 1000;

// Daily caps meeting-token `user_id` at 36 characters.
const DAILY_MAX_USER_ID_LENGTH = 36;

/**
 * Retry budget for Daily calls. Daily rate-limits the room and token endpoints (20 req/s)
 * and documents exponential backoff as the expected client behaviour.
 *
 * Three attempts with a 200ms base is ~600ms of added latency in the worst case, which is
 * affordable only because timeouts are excluded from retry (see shouldRetry) — the axios
 * instance already waits 10s, and retrying that would put a doctor on a 30s stall in the
 * middle of an appointment.
 */
const DAILY_MAX_ATTEMPTS = 3;
const DAILY_RETRY_BASE_MS = 200;

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
    private readonly eventEmitter: EventEmitter2,
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
    this.assertConfigured();

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
          // Carry over who the appointment was actually booked for. This used to be
          // hardcoded to SELF, which silently mislabelled every consultation booked on
          // behalf of someone else — and the field is projected into patient- and
          // doctor-facing responses, so the wrong value reached clients.
          //
          // Mapped explicitly rather than cast. AppointmentFor and ConsultationForEnum
          // happen to be identical today, but they are declared in different modules and
          // maintained separately; a cast would go on compiling if either gained a member.
          consoltation_for:
            appointment.appointment_for === AppointmentFor.OTHERS
              ? ConsultationForEnum.OTHERS
              : ConsultationForEnum.SELF,
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

    // Capture BEFORE the branch. The doctor's client calls this endpoint repeatedly while
    // the consultation is open, so gating on the endpoint would notify the patient on
    // every poll. Room creation happens once, and that is the moment the patient can
    // actually join -- it replaces sitting on the "Doctor hasn't opened the session yet"
    // retry loop that getPatientVideoToken throws.
    const roomExisted = !!appointment.daily_room_name;

    if (!appointment.daily_room_name) {
      await this.createRoomForAppointment(appointment);
    }

    if (!roomExisted && appointment.patient_id) {
      this.eventEmitter.emit(AppEvents.VIDEO_ROOM_OPENED, {
        appointment_id: appointment._id.toString(),
        consultation_id: consultation?._id ? consultation._id.toString() : null,
        patient_id: appointment.patient_id.toString(),
        doctor_id: doctor._id.toString(),
        scheduled_start_at_utc:
          appointment.scheduled_start_at_utc?.toISOString() ?? null,
        timezone_snapshot: appointment.timezone_snapshot ?? null,
      } as VideoRoomOpenedEvent);
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
    this.assertConfigured();

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

    // Mirrors the token endpoints. Unreachable in practice today — a consultation only
    // exists once a token was issued, and that already requires CONFIRMED — but leaving
    // the asymmetry in place invites a future caller that reaches this without one.
    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException(
        'Video is only available for confirmed appointments',
      );
    }

    this.assertWithinAppointmentWindow(appointment);

    // Filtered on status: a COMPLETED or CANCELED consultation must not be dragged back
    // to ACTIVE by a stray start call, which is exactly what an unfiltered $set did.
    // completeConsultation() guards the same transition from the other side.
    const consultation = await this.consultationModel.findOneAndUpdate(
      {
        appointment_id: appointment._id,
        status: {
          $nin: [
            ConsultationStatusEnum.COMPLETED,
            ConsultationStatusEnum.CANCELED,
          ],
        },
      },
      { $set: { status: ConsultationStatusEnum.ACTIVE } },
      { new: true, select: '_id' },
    );

    if (!consultation) {
      // Null is ambiguous — no consultation at all, or one in a terminal state — and the
      // two need different messages. Pay for the extra read only on this path, so the
      // happy path stays a single round trip.
      const existing = await this.consultationModel.findOne(
        { appointment_id: appointment._id },
        { _id: 1, status: 1 },
      );

      // Without a consultation there is nothing to activate — the doctor has
      // not fetched a video token yet, so fail loudly instead of no-opping.
      if (!existing) {
        throw new BadRequestException(
          'No consultation exists for this appointment yet. Request a video token first.',
        );
      }

      throw new ConflictException(`Consultation is already ${existing.status}`);
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
    //
    // Unconditional, unlike the `$exists: false` claim on video_started_at, and the
    // asymmetry is the point: the pair describes the session span as FIRST join to LAST
    // leave. A doctor who drops and rejoins should extend the end without moving the
    // start. Do not "fix" this into a matching compare-and-set.
    await this.appointmentModel.updateOne(
      { _id: appointment._id },
      { $set: { video_ended_at: new Date() } },
    );
  }

  // ---------- private helpers ----------

  /**
   * DAILY_API_KEY is optional — the app is expected to boot and serve everything else
   * without it. Without this check the key's absence is invisible until axios sends
   * `Bearer undefined`, Daily answers 401, and the caller gets a 500 blaming the server
   * for what is really an unconfigured deployment.
   *
   * 503 rather than 500 for the same reason CloudinaryService throws it: the feature is
   * genuinely unavailable, and that is not the caller's fault nor a bug to page on.
   * Called only from the two endpoints that talk to Daily — session start/end touch no
   * Daily endpoint and must keep working on a deployment with no video configured.
   */
  private assertConfigured(): void {
    if (!this.config.get<string>('daily.api_key')) {
      throw new ServiceUnavailableException('Video calling is not configured');
    }
  }

  /**
   * Runs a Daily call with bounded exponential backoff.
   *
   * A helper rather than an axios interceptor: an interceptor is instance-global and
   * invisible at the call site, so the retry policy would be impossible to read where it
   * matters and awkward to assert against the shared mock the tests use.
   */
  private async requestWithRetry<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= DAILY_MAX_ATTEMPTS || !this.shouldRetry(err)) {
          throw err;
        }

        const wait = this.retryDelayMs(err, attempt);
        this.logger.warn(
          `${label} failed (attempt ${attempt}/${DAILY_MAX_ATTEMPTS}), retrying in ${wait}ms`,
        );
        await this.delay(wait);
      }
    }
  }

  /**
   * Retry only what a second attempt can plausibly fix.
   *
   * Deliberately EXCLUDES the axios timeout (ECONNABORTED): that attempt already burned
   * the full 10s, and retrying it turns one slow request into a 30s stall for a doctor
   * mid-appointment. A timeout is better surfaced immediately than hidden behind a retry.
   *
   * Also excludes 4xx other than 429 — those are deterministic, so a retry just spends
   * another round trip arriving at the same answer.
   */
  private shouldRetry(err: any): boolean {
    const status = err?.response?.status;

    if (status === undefined) {
      // No response at all: a reset or DNS failure, which fails fast and is worth another
      // go. The timeout case is the one exception.
      return err?.code !== 'ECONNABORTED';
    }

    return status === 429 || status >= 500;
  }

  /** Honours Retry-After when Daily sends one, else exponential backoff with jitter. */
  private retryDelayMs(err: any, attempt: number): number {
    const retryAfter = Number(err?.response?.headers?.['retry-after']);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }

    const backoff = DAILY_RETRY_BASE_MS * 2 ** (attempt - 1);
    return backoff + Math.floor(Math.random() * DAILY_RETRY_BASE_MS);
  }

  /** Isolated so tests can stub it — the suite must never actually sleep. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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
    // Both derived from the shared constants so the API's own window checks and Daily's
    // nbf/exp cannot drift apart. See EARLY_JOIN_GRACE_MS / ROOM_OVERRUN_MS.
    const nbf = Math.floor(
      (appointment.scheduled_start_at_utc.getTime() - EARLY_JOIN_GRACE_MS) /
        1000,
    );
    const exp = Math.floor(
      (appointment.scheduled_end_at_utc.getTime() + ROOM_OVERRUN_MS) / 1000,
    );

    const roomName = `consultation-${appointment._id.toString()}`;

    let room: { name: string; url: string; config?: { exp?: number } };

    try {
      const { data } = await this.requestWithRetry('Create Daily room', () =>
        this.api.post('/rooms', {
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
        }),
      );
      room = data;
    } catch (err) {
      // Room names are deterministic, so a previous attempt may have created the room on
      // Daily before we managed to persist it — and a retry above can produce the same
      // collision. Adopt the existing room instead of failing forever.
      //
      // Detected by ASKING Daily, not by reading its error text. The previous version
      // matched `data.info.includes('already exists')`, but Daily documents `info` as
      // debugging prose whose content is not fixed, so a reword upstream would have
      // turned every retried booking into a permanent 500. Matching the stable `error`
      // field is no better: this case is `invalid-request-error`, which Daily also
      // returns for unrelated 400s such as a malformed Authorization header. A room that
      // exists under this name is ours by construction, so the lookup is the real test.
      const adopted =
        err?.response?.status === 400 ? await this.findRoom(roomName) : null;

      if (!adopted) {
        this.logger.error(
          'Failed to create Daily room',
          err?.response?.data ?? err,
        );
        throw new InternalServerErrorException('Failed to create video room');
      }

      this.logger.warn(`Daily room ${roomName} already exists — adopting it`);
      room = adopted;
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

  /**
   * Looks a room up by name, returning null when it does not exist or cannot be read.
   *
   * Returns null rather than throwing so the caller decides what a miss means. It has the
   * original creation error in hand and that is the more useful one to surface — a lookup
   * failure here is a symptom, not the cause. The distinct log line matters: the previous
   * version threw 'Failed to create video room' from both the create and the fetch, so
   * logs could not tell "Daily rejected the create" from "Daily then failed to hand us
   * the room it said already existed".
   */
  private async findRoom(
    roomName: string,
  ): Promise<{ name: string; url: string; config?: { exp?: number } } | null> {
    try {
      const { data } = await this.requestWithRetry('Fetch Daily room', () =>
        this.api.get(`/rooms/${encodeURIComponent(roomName)}`),
      );
      return data;
    } catch (err) {
      if (err?.response?.status !== 404) {
        this.logger.error(
          `Failed to fetch existing Daily room ${roomName}`,
          err?.response?.data ?? err,
        );
      }
      return null;
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
      const { data } = await this.requestWithRetry(
        'Create Daily meeting token',
        () =>
          this.api.post('/meeting-tokens', {
            properties: {
              room_name: opts.roomName,
              is_owner: opts.isOwner,
              user_name: opts.userName,
              user_id: opts.userId.slice(0, DAILY_MAX_USER_ID_LENGTH),
              exp: opts.exp,
              eject_at_token_exp: true,
            },
          }),
      );

      // A 2xx with no token would otherwise put `undefined` in the response body and fail
      // later, in the client, as an unjoinable call — far from the actual cause.
      if (typeof data?.token !== 'string' || !data.token.length) {
        this.logger.error(
          'Daily returned no meeting token',
          data ?? '(empty body)',
        );
        throw new InternalServerErrorException(
          'Failed to generate video token',
        );
      }

      return data.token as string;
    } catch (err) {
      // Already translated above — do not re-wrap and lose the specific log.
      if (err instanceof InternalServerErrorException) {
        throw err;
      }

      this.logger.error(
        'Failed to create meeting token',
        err?.response?.data ?? err,
      );
      throw new InternalServerErrorException('Failed to generate video token');
    }
  }
}

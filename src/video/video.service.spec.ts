import { Types } from 'mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus } from 'src/common/enums';
import { ConsultationStatusEnum } from 'src/consultations/consultations.enums';

const mockApi = { post: jest.fn(), get: jest.fn() };

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => mockApi) },
  create: jest.fn(() => mockApi),
}));

// Imported after the axios mock so the constructor picks it up.
import { VideoService } from './video.service';

describe('VideoService', () => {
  const configService = { get: jest.fn() };
  const appointmentModel = { findById: jest.fn(), updateOne: jest.fn() };
  const consultationModel = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };

  let service: VideoService;
  let doctorId: Types.ObjectId;
  let patientId: Types.ObjectId;
  let appointmentId: Types.ObjectId;
  let consultationId: Types.ObjectId;

  /** An appointment that is currently mid-window, so joining is allowed. */
  const buildAppointment = (overrides: Record<string, any> = {}) => ({
    _id: appointmentId,
    doctor_id: doctorId,
    patient_id: patientId,
    status: AppointmentStatus.CONFIRMED,
    scheduled_start_at_utc: new Date(Date.now() - 60_000),
    scheduled_end_at_utc: new Date(Date.now() + 20 * 60_000),
    daily_room_name: undefined,
    daily_room_url: undefined,
    daily_room_expires_at: undefined,
    consultation_id: undefined,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    doctorId = new Types.ObjectId();
    patientId = new Types.ObjectId();
    appointmentId = new Types.ObjectId();
    consultationId = new Types.ObjectId();

    service = new VideoService(
      configService as any,
      appointmentModel as any,
      consultationModel as any,
    );

    appointmentModel.updateOne.mockResolvedValue({});
    consultationModel.findOneAndUpdate.mockResolvedValue({
      _id: consultationId,
    });
    consultationModel.findOne.mockResolvedValue({ _id: consultationId });
    mockApi.post.mockImplementation((url: string) => {
      if (url === '/rooms') {
        return Promise.resolve({
          data: {
            name: `consultation-${appointmentId.toString()}`,
            url: `https://carelexa.daily.co/consultation-${appointmentId.toString()}`,
            config: { exp: Math.floor(Date.now() / 1000) + 3600 },
          },
        });
      }
      return Promise.resolve({ data: { token: 'daily-token' } });
    });
  });

  describe('input validation', () => {
    it('rejects a malformed appointment id without hitting the database', async () => {
      await expect(
        service.getDoctorVideoToken('not-an-object-id', { _id: doctorId }),
      ).rejects.toThrow(BadRequestException);

      expect(appointmentModel.findById).not.toHaveBeenCalled();
    });

    it('rejects a missing appointment', async () => {
      appointmentModel.findById.mockResolvedValue(null);

      await expect(
        service.getDoctorVideoToken(appointmentId.toString(), {
          _id: doctorId,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('authorization', () => {
    it('refuses a doctor who does not own the appointment', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({ doctor_id: new Types.ObjectId() }),
      );

      await expect(
        service.getDoctorVideoToken(appointmentId.toString(), {
          _id: doctorId,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a patient who does not own the appointment', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({ patient_id: new Types.ObjectId() }),
      );

      await expect(
        service.getPatientVideoToken(appointmentId.toString(), {
          _id: patientId,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses appointments that are not CONFIRMED', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({ status: AppointmentStatus.PENDING }),
      );

      await expect(
        service.getDoctorVideoToken(appointmentId.toString(), {
          _id: doctorId,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('appointment window', () => {
    it('refuses a join more than 10 minutes before the start', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({
          scheduled_start_at_utc: new Date(Date.now() + 30 * 60_000),
          scheduled_end_at_utc: new Date(Date.now() + 60 * 60_000),
        }),
      );

      await expect(
        service.getDoctorVideoToken(appointmentId.toString(), {
          _id: doctorId,
        }),
      ).rejects.toThrow(/scheduled time/);
    });

    it('allows a join inside the 10 minute grace period', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({
          scheduled_start_at_utc: new Date(Date.now() + 5 * 60_000),
          scheduled_end_at_utc: new Date(Date.now() + 35 * 60_000),
        }),
      );

      await expect(
        service.getDoctorVideoToken(appointmentId.toString(), {
          _id: doctorId,
        }),
      ).resolves.toMatchObject({ role: 'doctor' });
    });

    it('refuses a join after the window has ended', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({
          scheduled_start_at_utc: new Date(Date.now() - 60 * 60_000),
          scheduled_end_at_utc: new Date(Date.now() - 30 * 60_000),
        }),
      );

      await expect(
        service.getDoctorVideoToken(appointmentId.toString(), {
          _id: doctorId,
        }),
      ).rejects.toThrow(/already ended/);
    });
  });

  describe('doctor token', () => {
    it('creates the room and returns a token', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());

      const result = await service.getDoctorVideoToken(
        appointmentId.toString(),
        { _id: doctorId, full_name: 'Dr Ada' },
      );

      expect(result).toMatchObject({
        appointmentId: appointmentId.toString(),
        consultationId: consultationId.toString(),
        role: 'doctor',
        token: 'daily-token',
      });

      const roomCall = mockApi.post.mock.calls.find((c) => c[0] === '/rooms');
      expect(roomCall[1].privacy).toBe('private');
      expect(roomCall[1].properties).toMatchObject({
        max_participants: 2,
        enable_knocking: false,
        eject_at_room_exp: true,
      });

      const tokenCall = mockApi.post.mock.calls.find(
        (c) => c[0] === '/meeting-tokens',
      );
      expect(tokenCall[1].properties).toMatchObject({
        is_owner: true,
        user_name: 'Dr Ada',
        eject_at_token_exp: true,
      });
    });

    it('writes consultation_id back onto the appointment', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());

      await service.getDoctorVideoToken(appointmentId.toString(), {
        _id: doctorId,
      });

      expect(appointmentModel.updateOne).toHaveBeenCalledWith(
        { _id: appointmentId },
        { $set: { consultation_id: consultationId } },
      );
    });

    it('does not rewrite consultation_id when it is already linked', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({ consultation_id: consultationId }),
      );

      await service.getDoctorVideoToken(appointmentId.toString(), {
        _id: doctorId,
      });

      const linkWrites = appointmentModel.updateOne.mock.calls.filter(
        (c) => c[1]?.$set?.consultation_id !== undefined,
      );
      expect(linkWrites).toHaveLength(0);
    });

    it('reuses the existing room when Daily reports it already exists', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());
      const roomName = `consultation-${appointmentId.toString()}`;
      const roomExp = Math.floor(Date.now() / 1000) + 1800;

      mockApi.post.mockImplementation((url: string) => {
        if (url === '/rooms') {
          return Promise.reject({
            response: {
              status: 400,
              data: {
                error: 'invalid-request-error',
                info: `a room named ${roomName} already exists`,
              },
            },
          });
        }
        return Promise.resolve({ data: { token: 'daily-token' } });
      });
      mockApi.get.mockResolvedValue({
        data: {
          name: roomName,
          url: `https://carelexa.daily.co/${roomName}`,
          config: { exp: roomExp },
        },
      });

      const result = await service.getDoctorVideoToken(
        appointmentId.toString(),
        { _id: doctorId },
      );

      expect(mockApi.get).toHaveBeenCalledWith(`/rooms/${roomName}`);
      expect(result.token).toBe('daily-token');
      expect(result.expiresAt).toBe(new Date(roomExp * 1000).toISOString());
    });

    it('surfaces a 500 for non-recoverable Daily failures', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());
      mockApi.post.mockImplementation((url: string) =>
        url === '/rooms'
          ? Promise.reject({ response: { status: 500, data: {} } })
          : Promise.resolve({ data: { token: 'daily-token' } }),
      );

      await expect(
        service.getDoctorVideoToken(appointmentId.toString(), {
          _id: doctorId,
        }),
      ).rejects.toThrow(/Failed to create video room/);

      expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('skips room creation when the room already exists locally', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({
          daily_room_name: 'consultation-existing',
          daily_room_url: 'https://carelexa.daily.co/consultation-existing',
          daily_room_expires_at: new Date(Date.now() + 30 * 60_000),
        }),
      );

      await service.getDoctorVideoToken(appointmentId.toString(), {
        _id: doctorId,
      });

      expect(
        mockApi.post.mock.calls.filter((c) => c[0] === '/rooms'),
      ).toHaveLength(0);
    });
  });

  describe('display name', () => {
    const nameFromTokenCall = () =>
      mockApi.post.mock.calls.find((c) => c[0] === '/meeting-tokens')[1]
        .properties.user_name;

    it('falls back to first + last name when full_name is unset', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());

      await service.getDoctorVideoToken(appointmentId.toString(), {
        _id: doctorId,
        first_name: 'Ada',
        last_name: 'Okafor',
      });

      expect(nameFromTokenCall()).toBe('Ada Okafor');
    });

    it('falls back to a role label when no name is available at all', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());

      await service.getDoctorVideoToken(appointmentId.toString(), {
        _id: doctorId,
      });

      expect(nameFromTokenCall()).toBe('Doctor');
    });

    it('never sends an undefined user_name to Daily', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({
          daily_room_name: 'consultation-existing',
          daily_room_url: 'https://carelexa.daily.co/consultation-existing',
        }),
      );

      await service.getPatientVideoToken(appointmentId.toString(), {
        _id: patientId,
      });

      expect(nameFromTokenCall()).toBe('Patient');
    });
  });

  describe('patient token', () => {
    it('refuses to join before the doctor has opened the room', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());

      await expect(
        service.getPatientVideoToken(appointmentId.toString(), {
          _id: patientId,
        }),
      ).rejects.toThrow(/hasn't opened the session/);
    });

    it('issues a non-owner token once the room exists', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({
          daily_room_name: 'consultation-existing',
          daily_room_url: 'https://carelexa.daily.co/consultation-existing',
        }),
      );

      const result = await service.getPatientVideoToken(
        appointmentId.toString(),
        { _id: patientId, full_name: 'Chidi Eze' },
      );

      expect(result.role).toBe('patient');

      const tokenCall = mockApi.post.mock.calls.find(
        (c) => c[0] === '/meeting-tokens',
      );
      expect(tokenCall[1].properties.is_owner).toBe(false);
    });

    it('truncates user_id to the 36 character Daily limit', async () => {
      const oversizedId = { toString: () => 'x'.repeat(50) } as any;
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({
          patient_id: oversizedId,
          daily_room_name: 'consultation-existing',
          daily_room_url: 'https://carelexa.daily.co/consultation-existing',
        }),
      );

      await service.getPatientVideoToken(appointmentId.toString(), {
        _id: oversizedId,
      });

      const tokenCall = mockApi.post.mock.calls.find(
        (c) => c[0] === '/meeting-tokens',
      );
      expect(tokenCall[1].properties.user_id).toHaveLength(36);
    });
  });

  describe('session lifecycle', () => {
    it('activates the consultation and stamps the start time', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());

      await service.markSessionStarted(appointmentId.toString(), doctorId);

      expect(consultationModel.findOneAndUpdate).toHaveBeenCalledWith(
        { appointment_id: appointmentId },
        { $set: { status: ConsultationStatusEnum.ACTIVE } },
        { new: true, select: '_id' },
      );
      expect(appointmentModel.updateOne).toHaveBeenCalledWith(
        { _id: appointmentId, video_started_at: { $exists: false } },
        { $set: { video_started_at: expect.any(Date) } },
      );
    });

    it('fails loudly when there is no consultation to activate', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());
      consultationModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.markSessionStarted(appointmentId.toString(), doctorId),
      ).rejects.toThrow(/Request a video token first/);

      expect(appointmentModel.updateOne).not.toHaveBeenCalled();
    });

    it('stamps the end time without completing the consultation', async () => {
      appointmentModel.findById.mockResolvedValue(buildAppointment());

      await service.markSessionEnded(appointmentId.toString(), doctorId);

      expect(appointmentModel.updateOne).toHaveBeenCalledWith(
        { _id: appointmentId },
        { $set: { video_ended_at: expect.any(Date) } },
      );
      expect(consultationModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses to end a session for another doctor', async () => {
      appointmentModel.findById.mockResolvedValue(
        buildAppointment({ doctor_id: new Types.ObjectId() }),
      );

      await expect(
        service.markSessionEnded(appointmentId.toString(), doctorId),
      ).rejects.toThrow(ForbiddenException);

      expect(appointmentModel.updateOne).not.toHaveBeenCalled();
    });
  });
});

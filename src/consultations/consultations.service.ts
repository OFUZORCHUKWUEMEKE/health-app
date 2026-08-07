import {
  BadRequestException,
  ConflictException,
  ConsoleLogger,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConsultationRepository } from './consultations.repository';
import { CoreService } from 'src/common/core/service.core';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import {
  Consultation,
  Diagnosis,
  HistoryTakingStatus,
} from './consultations.model';
import { generateSessionCode } from 'src/utils/code-generator.util';
import { ConsultationFactory } from './consultation.factory';
import { InvestigationDto } from './dto/create-investigation.dto';
import { InvestigationRepository } from './investigation.repository';
import { DiagnosisDto } from './dto/create-dignosis.dto';
import { DiagnosisRepository } from './diagnosis.repository';
import { Types } from 'mongoose';
import { CoreSearchFilterDatePaginationDto } from 'src/common/core/dto.core';
import {
  ConsultationForEnum,
  ConsultationStatusEnum,
  ConsultationTypeEnum,
} from './consultations.enums';
import { MedicationRepository } from './medication.repository';
import { ReferralRepository } from './referral.repository';
import {
  CreateReferralDto,
  UpdateReferralDto,
} from './dto/create-referral.dto';
import { ComplaintHistoryRepository } from './compliant-history.repository';
import { PhysicalExamsRepository } from './physical-exams.repository';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { AppointmentStatus } from 'src/common/enums';
import { CreateMedicationDto } from './dto/create-medication';
import { HistoryTakingRepository } from './history-taking.repository';
import {
  CreateHistoryTakingDto,
  UpdateHistoryTakingDto,
} from './dto/create-history-taking.dto';
import { InvestigationFormRepository } from './investigation-form.repository';
import {
  CreateInvestigationFormDto,
  UpdateInvestigationFormDto,
} from './dto/create-investigation-result.dto';
import { TreatmentPlanRepository } from './treatment-plan.repository';
import {
  CreateTreatmentPlanDto,
  UpdateTreatmentPlanDto,
} from './dto/create-treatment-plan.dto';
import { DiagnosisFormRepository } from './diagnosis-form.repository';
import {
  CreateDiagnosisFormDto,
  UpdateDiagnosisFormDto,
} from './dto/create-diagnosis-form.dto';
import { InvestigationListRepository } from './investigation-list.repository';
import {
  CreateInvestigationListDto,
  UpdateInvestigationListDto,
} from './dto/create-investigation-list.dto';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

@Injectable()
export class ConsultationsService extends CoreService<ConsultationRepository> {
  constructor(
    private readonly consultationRepository: ConsultationRepository,
    private readonly consultationFactory: ConsultationFactory,
    private readonly investigationRepository: InvestigationRepository,
    private readonly diagnosisRepository: DiagnosisRepository,
    private readonly medicationRepository: MedicationRepository,
    private readonly referralRepository: ReferralRepository,
    private readonly complaintHistoryRepository: ComplaintHistoryRepository,
    private readonly physicalExam: PhysicalExamsRepository,
    private readonly historyTakingRepository: HistoryTakingRepository,
    private readonly investigationFormRepository: InvestigationFormRepository,
    private readonly investigationListRepository: InvestigationListRepository,
    private readonly treatmentPlanRepository: TreatmentPlanRepository,
    private readonly diagnosisFormRepository: DiagnosisFormRepository,
    @InjectModel('Appointment')
    private readonly appointmentModel: Model<AppointmentDocument>,
    private readonly cloudinaryService: CloudinaryService,
    // @InjectModel('diagnosis') private readonly diagnosisModel: Diagnosis,
  ) {
    super(consultationRepository);
  }

  async startConsultationFromAppointment(
    doctor_id: string,
    appointment_id: string,
    createConsultation: Partial<CreateConsultationDto> = {},
  ) {
    if (!Types.ObjectId.isValid(appointment_id)) {
      throw new BadRequestException('Invalid appointment id');
    }

    const appointment = await this.appointmentModel.findOne({
      _id: new Types.ObjectId(appointment_id),
      doctor_id: new Types.ObjectId(doctor_id),
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found for this doctor');
    }

    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new ConflictException(
        'Consultation can only be started from a confirmed appointment',
      );
    }

    const existingConsultation = await this.consultationRepository.findOne({
      appointment_id: appointment._id,
    });

    if (existingConsultation) {
      if (
        [
          ConsultationStatusEnum.CANCELED,
          ConsultationStatusEnum.COMPLETED,
        ].includes(existingConsultation.status)
      ) {
        throw new ConflictException(
          `Consultation is already ${existingConsultation.status}`,
        );
      }

      const updatedConsultation =
        await this.consultationRepository.findOneAndUpdate(
          { _id: existingConsultation._id },
          {
            $set: {
              status: ConsultationStatusEnum.ACTIVE,
              doctor_id: appointment.doctor_id,
              user_id: appointment.patient_id,
              ...(createConsultation.title
                ? { title: createConsultation.title }
                : {}),
              ...(createConsultation.details
                ? { details: createConsultation.details }
                : {}),
              ...(createConsultation.treatment_plan
                ? { treatment_plan: createConsultation.treatment_plan }
                : {}),
            },
          },
          {},
        );

      await this.appointmentModel.updateOne(
        { _id: appointment._id },
        {
          $set: {
            consultation_id: existingConsultation._id,
          },
        },
      );

      return updatedConsultation;
    }

    const payload: CreateConsultationDto = {
      type: createConsultation.type || ConsultationTypeEnum.VIDEO,
      consoltation_for:
        createConsultation.consoltation_for || ConsultationForEnum.SELF,
      title: createConsultation.title || 'Consultation from booking',
      ...(createConsultation.details
        ? { details: createConsultation.details }
        : {}),
      ...(createConsultation.treatment_plan
        ? { treatment_plan: createConsultation.treatment_plan }
        : {}),
    };

    const consultation = await this.consultationFactory.createNew(
      payload,
      appointment.patient_id,
    );
    consultation.doctor_id = appointment.doctor_id;
    consultation.appointment_id = appointment._id;
    consultation.status = ConsultationStatusEnum.ACTIVE;

    const data = await this.consultationRepository.create(consultation);

    await this.appointmentModel.updateOne(
      { _id: appointment._id },
      {
        $set: {
          consultation_id: data._id,
        },
      },
    );

    return data;
  }

  async completeConsultation(doctor_id: string, consultation_id: string) {
    if (!Types.ObjectId.isValid(consultation_id)) {
      throw new BadRequestException('Invalid consultation id');
    }

    const consultation = await this.consultationRepository.findOne({
      _id: new Types.ObjectId(consultation_id),
      doctor_id: new Types.ObjectId(doctor_id),
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found for this doctor');
    }

    if (consultation.status === ConsultationStatusEnum.CANCELED) {
      throw new ConflictException('Canceled consultation cannot be completed');
    }

    if (consultation.status === ConsultationStatusEnum.COMPLETED) {
      throw new ConflictException('Consultation is already completed');
    }

    const updatedConsultation =
      await this.consultationRepository.findOneAndUpdate(
        { _id: consultation._id },
        { $set: { status: ConsultationStatusEnum.COMPLETED } },
        {},
      );

    if (consultation.appointment_id) {
      await this.appointmentModel.updateOne(
        {
          _id: consultation.appointment_id,
          doctor_id: new Types.ObjectId(doctor_id),
          status: {
            $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
          },
        },
        {
          $set: {
            status: AppointmentStatus.COMPLETED,
          },
        },
      );
    }

    return updatedConsultation;
  }

  async singleConsultion(consultation_id, patient_id) {
    const data = await this.consultationRepository
      .model()
      .findOne({ _id: consultation_id })
      .populate({
        path: 'doctor_id',
      })
      .populate({
        path: 'medication_id',
        select:
          'formulary medication dose unit interval duration duration_unit status consultation_id doctor_id user_id createdAt updatedAt',
      })
      .populate({
        path: 'investigation_id',
        select:
          'name file status consultation_id doctor_id user_id createdAt updatedAt',
      })
      .populate({
        path: 'diagnosis_id',
        select:
          'title description consultation_id doctor_id user_id createdAt updatedAt',
      })
      .populate({
        path: 'appointment_id',
        select:
          'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
      });

    if (!data) throw new NotFoundException('Consultation not found');
    if (data.user_id.toString() !== patient_id.toString())
      throw new UnauthorizedException('Invalid User');
    await this.ensureConsultationLinkedDataPopulated(data);
    return data;
  }

  async singleDoctorConsultation(consultation_id, doctor_id) {
    const data = await this.consultationRepository
      .model()
      .findOne({ _id: consultation_id })
      .populate({
        path: 'user_id',
        select: '-token -password',
      })
      .populate({
        path: 'medication_id',
        select:
          'formulary medication dose unit interval duration duration_unit status consultation_id doctor_id user_id createdAt updatedAt',
        populate: [
          {
            path: 'user_id',
            select:
              'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
          },
          {
            path: 'doctor_id',
            select:
              'first_name last_name full_name email specializations profile_picture_url',
          },
        ],
      })
      .populate({
        path: 'investigation_id',
        select:
          'name file status consultation_id doctor_id user_id createdAt updatedAt',
      })
      .populate({
        path: 'diagnosis_id',
        select:
          'title description consultation_id doctor_id user_id createdAt updatedAt',
      })
      .populate({
        path: 'appointment_id',
        populate: [
          {
            path: 'patient_id',
            select:
              'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
          },
          {
            path: 'doctor_id',
            select:
              'first_name last_name full_name email specializations profile_picture_url',
          },
        ],
      });

    if (!data) throw new NotFoundException('Consultation not found');
    if (data.doctor_id.toString() !== doctor_id.toString())
      throw new UnauthorizedException('Invalid User');
    await this.ensureConsultationLinkedDataPopulated(data);
    return data;
  }

  private isUnpopulatedArray(arr: any[]): boolean {
    if (!Array.isArray(arr) || arr.length === 0) return true;
    return arr.every(
      (item) => typeof item === 'string' || item instanceof Types.ObjectId,
    );
  }

  private async ensureConsultationLinkedDataPopulated(consultation: any) {
    const consultationId = consultation?._id;
    if (!consultationId) return;

    if (this.isUnpopulatedArray(consultation.medication_id)) {
      const medications = await this.medicationRepository
        .model()
        .find({ consultation_id: consultationId })
        .select(
          'formulary medication dose unit interval duration duration_unit status consultation_id doctor_id user_id createdAt updatedAt',
        )
        .populate({
          path: 'user_id',
          select:
            'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
        })
        .populate({
          path: 'doctor_id',
          select:
            'first_name last_name full_name email specializations profile_picture_url',
        })
        .lean();
      consultation.medication_id = medications;
    }

    if (this.isUnpopulatedArray(consultation.investigation_id)) {
      const investigations = await this.investigationRepository
        .model()
        .find({ consultation_id: consultationId })
        .select(
          'name file status consultation_id doctor_id user_id createdAt updatedAt',
        )
        .lean();
      consultation.investigation_id = investigations;
    }

    if (this.isUnpopulatedArray(consultation.diagnosis_id)) {
      const diagnoses = await this.diagnosisRepository
        .model()
        .find({ consultation_id: consultationId })
        .select(
          'title description consultation_id doctor_id user_id createdAt updatedAt',
        )
        .lean();
      consultation.diagnosis_id = diagnoses;
    }
  }

  async findPatientConsultation(
    patients_id,
    query: CoreSearchFilterDatePaginationDto,
  ) {
    // console.log(patients_id)
    const { page, perPage } = query;
    const total = await this.consultationRepository
      .model()
      .countDocuments({ user_id: patients_id });
    let consultation = await this.consultationRepository
      .model()
      .find({ user_id: patients_id })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      })
      .populate({
        path: 'appointment_id',
        select:
          'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
      })
      .sort({ createdAt: -1 })
      .skip(((+page || 1) - 1) * (+perPage || 10))
      .limit(+perPage || 10);
    if (!consultation) throw new ConflictException('Invalid Consulation');
    return {
      consultation,
      meta: {
        total,
        page: +page || 1,
        lastPage: total === 0 ? 1 : Math.ceil(total / (+perPage || 10)),
      },
    };
    // return consultation
  }

  async getAllPatientConsultation(patient_id: string) {
    return this.consultationRepository
      .model()
      .find({ user_id: patient_id })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      })
      .populate({
        path: 'appointment_id',
        select:
          'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
      })
      .sort({ createdAt: -1 });
  }

  async findDoctorInvestigation(doctor_id, query) {
    const { page, perPage } = query;
    const total = await this.investigationRepository
      .model()
      .countDocuments({ doctor_id });
    let investigation = await this.investigationRepository
      .model()
      .find({ doctor_id: doctor_id }, {}, { populate: 'consultation_id' })
      .skip(((+page || 1) - 1) * (+perPage || 10))
      .limit(+perPage || 10);
    if (!investigation) throw new ConflictException('Invalid User');
    return {
      investigation,
      meta: {
        total,
        page: +page || 1,
        lastPage: total === 0 ? 1 : Math.ceil(total / (+perPage || 10)),
      },
    };
  }
  async findDoctorDiagnosis(doctor_id) {
    let diagnosis = await this.diagnosisRepository.find(
      { doctor_id: doctor_id },
      {},
      { populate: 'consultation_id' },
    );
    if (!diagnosis) throw new ConflictException('Invalid User');
    return diagnosis;
  }

  async findPatientInvestigation(patients_id, query) {
    const { page, perPage } = query;
    const total = await this.investigationRepository
      .model()
      .countDocuments({ user_id: patients_id });
    let investigation = await this.investigationRepository
      .model()
      .find({ user_id: patients_id }, {}, { populate: 'consultation_id' })
      .sort({ _id: -1 })
      .skip(((+page || 1) - 1) * (+perPage || 10))
      .limit(+perPage || 10);
    if (!investigation) throw new ConflictException('Invalid User');
    return {
      investigation,
      meta: {
        total,
        page: +page || 1,
        lastPage: total === 0 ? 1 : Math.ceil(total / (+perPage || 10)),
      },
    };
  }

  async findPatientDiagnosis(patients_id, query) {
    const { page, perPage } = query;
    const total = await this.diagnosisRepository
      .model()
      .countDocuments({ user_id: patients_id });
    let diagnosis = await this.diagnosisRepository
      .model()
      .find({ user_id: patients_id }, {}, { populate: 'consultation_id' })
      .sort({ _id: -1 })
      .skip(((+page || 1) - 1) * (+perPage || 10))
      .limit(+perPage || 10);
    if (!diagnosis) throw new ConflictException('Invalid User');
    return {
      diagnosis,
      meta: {
        total,
        page: +page || 1,
        lastPage: total === 0 ? 1 : Math.ceil(total / (+perPage || 10)),
      },
    };
  }

  async findDoctorConsultation(doctor_id, query) {
    const { page, perPage } = query;
    const total = await this.consultationRepository
      .model()
      .countDocuments({ doctor_id });
    let consultation = await this.consultationRepository
      .model()
      .find({ doctor_id: doctor_id })
      .populate({
        path: 'appointment_id',
        select:
          'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
      })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email phone_number specializations profile_picture_url',
      })
      .sort({ createdAt: -1 })
      .skip(((+page || 1) - 1) * (+perPage || 10))
      .limit(+perPage || 10);
    if (!consultation) throw new ConflictException('Invalid Consulation');
    return {
      consultation,
      meta: {
        total,
        page: +page || 1,
        lastPage: total === 0 ? 1 : Math.ceil(total / (+perPage || 10)),
      },
    };
  }

  async getAllDoctorConsultation(doctor_id: string) {
    return this.consultationRepository
      .model()
      .find({ doctor_id })
      .populate({
        path: 'appointment_id',
        select:
          'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
      })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email phone_number specializations profile_picture_url',
      })
      .sort({ createdAt: -1 });
  }

  async findByUser(user_id: string): Promise<Consultation[]> {
    return await this.consultationRepository.find({ user_id });
  }

  async findByDoctor(doctor_id: string): Promise<Consultation[]> {
    return this.consultationRepository.find({ doctor_id });
  }

  async createInvestigation(
    investigation: InvestigationDto,
    doctor_id: string,
    consultation_id,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new ConflictException('Invalid Consultation');
    // if (consultation.status === ConsultationStatusEnum.PENDING) throw new ConflictException("Consultation not Active Yet")
    if (consultation.status === ConsultationStatusEnum.CANCELED)
      throw new ConflictException('Consultation Canceled');
    // Check if the doctor is the owner of the consultation
    if (consultation.doctor_id.toString() !== doctor_id.toString())
      throw new UnauthorizedException('Invalid User');
    const promises = investigation.name.map(async (name) => {
      const consultationAttributes = {
        consultation_id,
        doctor_id: doctor_id,
        user_id: consultation.user_id,
        name, // Storing individual investigation name
      };
      return this.investigationRepository.create(consultationAttributes);
    });
    const createdInvestigations = await Promise.all(promises);

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultation_id },
      {
        $addToSet: {
          investigation_id: {
            $each: createdInvestigations.map((item: any) => item._id),
          },
        },
      },
      {},
    );

    return { message: 'Investigations created successfully' };
  }

  async findInvestigation(consultation_id) {
    const data = await this.investigationRepository.find({ consultation_id });
    if (data.length === 0)
      throw new BadRequestException('No investigation found');
    return data;
  }

  async deleteInvestigation(investigation_id) {
    const data = await this.investigationRepository.findOne({
      _id: investigation_id,
    });
    if (!data) throw new BadRequestException('Invalid investigation id');
    await this.investigationRepository.delete({ _id: investigation_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: data.consultation_id },
      { $pull: { investigation_id: data._id } },
      {},
    );
    return { message: 'Investigation deleted successfully' };
  }

  async uploadInvestigation(investigation_id, file) {
    const data = await this.investigationRepository.findOne({
      _id: investigation_id,
    });
    if (!data) throw new BadRequestException('Invalid investigation id');
    const result = await this.investigationRepository.findOneAndUpdate(
      { _id: investigation_id },
      { file },
      {},
    );
    return { message: 'Investigation uploaded successfully' };
  }

  async findDoctorConsultationInvestigation(doctor_id, consultation_id, query) {
    const { page, perPage } = query;
    const total = await this.investigationRepository
      .model()
      .countDocuments({ doctor_id, consultation_id });
    const data = await this.investigationRepository
      .model()
      .find({ doctor_id, consultation_id })
      .sort({ _id: -1 })
      .skip(((+page || 1) - 1) * (+perPage || 10))
      .limit(+perPage || 10);
    if (!data) throw new BadRequestException('Invalid Credentials');
    return {
      data,
      meta: {
        total,
        page: +page || 1,
        lastPage: total === 0 ? 1 : Math.ceil(total / (+perPage || 10)),
      },
    };
  }

  async findSingleDoctorInvestigation(doctor_id, investigation_id) {
    const data = await this.investigationRepository.findOne({
      doctor_id,
      _id: investigation_id,
    });
    if (!data) throw new ConflictException('Invalid Credentials');
    return data;
  }

  async createDiagnosis(diagnosis: DiagnosisDto, doctor_id, consultation_id) {
    try {
      const consultation = await this.consultationRepository.findOne({
        _id: consultation_id,
      });
      if (!consultation) throw new ConflictException('Invalid Consultation');
      // if (consultation.status === ConsultationStatusEnum.PENDING) throw new ConflictException("Consultation not Active Yet")
      // if (consultation.status === ConsultationStatusEnum.CANCELED) throw new ConflictException("Consultation Canceled")
      // Check if the doctor is the owner of the consultation
      if (consultation.doctor_id.toString() !== doctor_id.toString())
        throw new UnauthorizedException(
          'You are not authorized to perform this action',
        );
      const diagnosisAttr: Record<string, any> = {};
      diagnosisAttr.consultation_id = consultation_id;
      diagnosisAttr.doctor_id = doctor_id;
      diagnosisAttr.user_id = consultation.user_id;
      diagnosisAttr.title = diagnosis.title;
      diagnosisAttr.description = diagnosis.description;
      const existingDiagnosis = await this.diagnosisRepository.findOne({
        title: diagnosis.title,
        consultation_id,
      });
      if (existingDiagnosis) {
        throw new ConflictException(
          `A diagnosis with title "${diagnosis.title}" already exists.`,
        );
      }
      const data = await this.diagnosisRepository.create(diagnosisAttr);
      await this.consultationRepository.findOneAndUpdate(
        { _id: consultation_id },
        { $addToSet: { diagnosis_id: data._id } },
        {},
      );
      return data;
    } catch (error) {
      throw error; // Rethrow other unexpected errors
    }
  }

  async findDiagnosis(diagnosis_id, doctor_id) {
    const data = await this.diagnosisRepository.find({
      _id: diagnosis_id,
      doctor_id,
    });
    if (!data) throw new BadRequestException('Invalid Credentials');
    return data;
  }

  async deleteDiagnosis(diagnosis_id, doctor_id) {
    const diagnosis = await this.diagnosisRepository.findOne({
      _id: diagnosis_id,
    });
    if (!diagnosis) throw new BadRequestException('Invalid diagnosis id');
    if (diagnosis.doctor_id !== doctor_id)
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    await this.diagnosisRepository.delete({ _id: diagnosis_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: diagnosis.consultation_id },
      { $pull: { diagnosis_id: diagnosis._id } },
      {},
    );
    return { message: 'Deleted Diagnosis successfully' };
  }

  async getConsultationDiagnosis(doctor_id, consultation_id) {
    const data = await this.diagnosisRepository.find({
      consultation_id,
      doctor_id,
    });
    if (!data) throw new BadRequestException('Invalid Credentials');
    return data;
  }

  async createMedication(
    payload: CreateMedicationDto,
    doctor_id,
    consultation_id,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new ConflictException('Invalid Consultation');
    if (consultation.doctor_id?.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to add medication to this consultation',
      );
    }
    if (!consultation.doctor_id)
      throw new BadRequestException('Doctor not assigned yet');

    const medications = payload.medications;
    if (!Array.isArray(medications) || medications.length === 0) {
      throw new BadRequestException('medications must be a non-empty array');
    }

    const consultationObjectId =
      this.normalizeConsultationIdRef(consultation_id);

    const created = await Promise.all(
      medications.map((item) =>
        this.medicationRepository.create({
          ...item,
          doctor_id,
          consultation_id: consultationObjectId,
          user_id:
            item.assign_to_patient === true ? consultation.user_id : null,
        }),
      ),
    );

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultationObjectId },
      {
        $addToSet: { medication_id: { $each: created.map((m: any) => m._id) } },
      },
      {},
    );

    return created;
  }

  async findPatientMedication(patients_id, consultation_id) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
      user_id: patients_id,
    });
    if (!consultation) throw new BadRequestException('Invalid consultation');

    const data = await this.medicationRepository.find({
      consultation_id: this.consultationIdMatch(consultation_id),
      assign_to_patient: true,
    });
    if (!data) throw new BadRequestException('No medication found');
    return data;
  }

  async findGroupedPatientMedicationByConsultation(
    patient_id: Types.ObjectId,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
      user_id: patient_id,
    });
    if (!consultation) throw new BadRequestException('Invalid consultation');

    const medications = await this.medicationRepository
      .model()
      .find({
        consultation_id: this.consultationIdMatch(consultation_id),
        assign_to_patient: true,
      })
      .populate(
        'consultation_id',
        'title type consoltation_for status session_number createdAt updatedAt',
      )
      .sort({ createdAt: 1 })
      .exec();

    const groupsMap = new Map<string, any[]>();
    for (const med of medications) {
      const key = (med as any).formulary ?? 'UNSPECIFIED';
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key)!.push(med);
    }

    const groups = Array.from(groupsMap.entries()).map(
      ([formulary, items]) => ({
        formulary,
        count: items.length,
        medications: items,
      }),
    );

    return {
      consultation_id: consultation,
      total: medications.length,
      groups,
    };
  }

  async findAllPatientMedications(patient_id: Types.ObjectId, status?: string) {
    const filter: Record<string, unknown> =
      await this.buildPatientAssignedMedicationFilter(patient_id);
    if (status) filter.status = status;

    const data = await this.medicationRepository
      .model()
      .find(filter)
      .populate('consultation_id', 'title type createdAt')
      .populate('doctor_id', 'full_name first_name last_name')
      .sort({ createdAt: -1 })
      .exec();

    return data;
  }

  private normalizeConsultationIdRef(
    consultation_id: Types.ObjectId | string,
  ): Types.ObjectId {
    return consultation_id instanceof Types.ObjectId
      ? consultation_id
      : new Types.ObjectId(String(consultation_id));
  }

  private consultationIdMatch(consultation_id: Types.ObjectId | string) {
    const objectId = this.normalizeConsultationIdRef(consultation_id);
    return { $in: [objectId, String(objectId)] };
  }

  private async getPatientConsultationIds(patient_id: Types.ObjectId) {
    return this.consultationRepository
      .model()
      .find({ user_id: patient_id })
      .select('_id')
      .lean()
      .then((rows) => rows.map((row) => row._id));
  }

  private async buildPatientAssignedMedicationFilter(
    patient_id: Types.ObjectId,
  ) {
    const patientConsultationIds =
      await this.getPatientConsultationIds(patient_id);
    const consultationRefs = patientConsultationIds.flatMap((id) => [
      id,
      String(id),
    ]);

    const orClauses: Record<string, unknown>[] = [{ user_id: patient_id }];
    if (consultationRefs.length > 0) {
      orClauses.push({ consultation_id: { $in: consultationRefs } });
    }

    return {
      assign_to_patient: true,
      $or: orClauses,
    };
  }

  private async findPatientAssignedMedications(patient_id: Types.ObjectId) {
    const filter = await this.buildPatientAssignedMedicationFilter(patient_id);

    return this.medicationRepository
      .model()
      .find(filter)
      .populate({
        path: 'consultation_id',
        select:
          'appointment_id type title details status consultation_id session_number createdAt updatedAt',
        populate: {
          path: 'appointment_id',
          select:
            'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
        },
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      })
      .sort({ createdAt: -1 })
      .lean();
  }

  async getPatientMedicationsGroupedByConsultation(
    patient_id: string,
    page = 1,
    perPage = 20,
  ) {
    const uid = new Types.ObjectId(patient_id);
    const medications = await this.findPatientAssignedMedications(uid);

    return this.groupMedicationRecordsByConsultation(
      medications,
      page,
      perPage,
    );
  }

  async findSinglePatientMedication(
    patient_id: Types.ObjectId,
    medication_id: string,
  ) {
    const filter = await this.buildPatientAssignedMedicationFilter(patient_id);

    const data = await this.medicationRepository
      .model()
      .findOne({
        ...filter,
        _id: medication_id,
      })
      .populate('consultation_id')
      .populate('doctor_id', 'full_name first_name last_name specializations')
      .exec();

    if (!data) throw new NotFoundException('Medication not found');
    return data;
  }

  async findMedication(doctor_id, consultation_id) {
    const data = await this.medicationRepository
      .model()
      .find({ doctor_id, consultation_id })
      .populate('consultation_id')
      .populate('user_id')
      .populate('doctor_id');
    if (!data) throw new BadRequestException('No medication found');
    return data;
  }

  async findGroupedMedicationByConsultation(doctor_id, consultation_id) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new BadRequestException('Invalid consultation');
    if (consultation.doctor_id?.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to view medications for this consultation',
      );
    }

    const medications = await this.medicationRepository
      .model()
      .find({ consultation_id })
      .sort({ createdAt: 1 })
      .exec();

    const groupsMap = new Map<string, any[]>();
    for (const med of medications) {
      const key = (med as any).formulary ?? 'UNSPECIFIED';
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key)!.push(med);
    }

    const groups = Array.from(groupsMap.entries()).map(
      ([formulary, items]) => ({
        formulary,
        count: items.length,
        medications: items,
      }),
    );

    return {
      consultation_id,
      total: medications.length,
      groups,
    };
  }

  async getDoctorMedicationsGroupedByConsultation(
    doctor_id: string,
    page = 1,
    perPage = 20,
  ) {
    const doctorObjectId = new Types.ObjectId(doctor_id);
    const medications = await this.medicationRepository
      .model()
      .find({ doctor_id: doctorObjectId })
      .populate({
        path: 'consultation_id',
        select:
          'appointment_id type title details status consultation_id session_number createdAt updatedAt',
        populate: [
          {
            path: 'appointment_id',
            select:
              'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
          },
          {
            path: 'user_id',
            select:
              'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
          },
        ],
      })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .sort({ createdAt: -1 })
      .lean();

    return this.groupMedicationRecordsByConsultation(
      medications,
      page,
      perPage,
    );
  }

  private groupMedicationRecordsByConsultation(
    medications: any[],
    page = 1,
    perPage = 20,
  ) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePerPage = Math.min(Math.max(1, Number(perPage) || 20), 100);
    const grouped = new Map<
      string,
      {
        consultation: any;
        medication_count: number;
        medications: any[];
        latest_created_at: Date;
      }
    >();

    for (const medication of medications) {
      const consultation = medication.consultation_id || null;
      const consultationKey = consultation?._id
        ? String(consultation._id)
        : String(medication.consultation_id);

      if (!grouped.has(consultationKey)) {
        grouped.set(consultationKey, {
          consultation,
          medication_count: 0,
          medications: [],
          latest_created_at: medication.createdAt,
        });
      }

      const group = grouped.get(consultationKey);
      group.medications.push(medication);
      group.medication_count += 1;

      if (
        medication.createdAt &&
        new Date(medication.createdAt) > new Date(group.latest_created_at)
      ) {
        group.latest_created_at = medication.createdAt;
      }
    }

    const allGroups = Array.from(grouped.values())
      .sort(
        (a, b) =>
          new Date(b.latest_created_at).getTime() -
          new Date(a.latest_created_at).getTime(),
      )
      .map(({ latest_created_at, ...group }) => group);

    const total = allGroups.length;
    const start = (safePage - 1) * safePerPage;

    return {
      groups: allGroups.slice(start, start + safePerPage),
      pagination: {
        total,
        page: safePage,
        perPage: safePerPage,
        total_pages: total === 0 ? 1 : Math.ceil(total / safePerPage),
      },
    };
  }

  async findSingleMedication(doctor_id, medication_id) {
    const data = await this.medicationRepository.findOne({
      doctor_id,
      _id: medication_id,
    });
    if (!data) throw new NotFoundException('Medication not found');
    return data;
  }

  async updateMedication(medication_id, medication, doctor_id) {
    const data = await this.medicationRepository.findOne({
      _id: medication_id,
    });
    if (!data) throw new BadRequestException('Invalid medication id');
    if (data.doctor_id.toString() !== doctor_id.toString())
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );

    const updatePayload: Record<string, any> = { ...medication };

    if (medication.assign_to_patient !== undefined) {
      if (medication.assign_to_patient) {
        const consultation = await this.consultationRepository.findOne({
          _id: data.consultation_id,
        });
        if (!consultation)
          throw new NotFoundException('Consultation not found');
        updatePayload.user_id = consultation.user_id;
      } else {
        updatePayload.user_id = null;
      }
    }

    if (medication.assign_to_patient === true && data.consultation_id) {
      updatePayload.consultation_id = this.normalizeConsultationIdRef(
        data.consultation_id,
      );
    }

    const update = await this.medicationRepository.findOneAndUpdate(
      { _id: medication_id },
      updatePayload,
      { new: true },
    );
    return update;
  }

  // ---------- Referrals ----------

  async createReferral(
    payload: CreateReferralDto,
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new BadRequestException('Invalid consultation');
    if (consultation.doctor_id?.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to add a referral to this consultation',
      );
    }
    if (!consultation.user_id)
      throw new BadRequestException('Consultation has no patient attached');

    const assignToPatient = payload.assign_to_patient === true;
    const consultationObjectId =
      this.normalizeConsultationIdRef(consultation_id);

    const created = await this.referralRepository.create({
      specialist_name: payload.specialist_name,
      hospital: payload.hospital,
      referral_details: payload.referral_details,
      referred_doctor_name: payload.referred_doctor_name?.trim() || null,
      assign_to_patient: assignToPatient,
      doctor_id,
      consultation_id: consultationObjectId,
      user_id: assignToPatient ? consultation.user_id : null,
    });

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultationObjectId },
      { $addToSet: { referral_id: (created as any)._id } },
      {},
    );

    return created;
  }

  async findReferralsByConsultation(
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new BadRequestException('Invalid consultation');
    if (consultation.doctor_id?.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to view referrals for this consultation',
      );
    }

    return this.referralRepository
      .model()
      .find({ consultation_id: this.consultationIdMatch(consultation_id) })
      .populate('consultation_id')
      .populate('user_id')
      .populate('doctor_id')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findSingleReferral(doctor_id: string, referral_id: string) {
    const referral = await this.referralRepository
      .model()
      .findOne({ _id: referral_id, doctor_id })
      .populate('consultation_id')
      .populate('user_id')
      .populate('doctor_id')
      .exec();
    if (!referral) throw new NotFoundException('Referral not found');
    return referral;
  }

  async updateReferral(
    referral_id: string,
    payload: UpdateReferralDto,
    doctor_id: string,
  ) {
    const referral = await this.referralRepository.findOne({
      _id: referral_id,
    });
    if (!referral) throw new BadRequestException('Invalid referral id');
    if (referral.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }
    const updatePayload: UpdateReferralDto & {
      referred_doctor_name?: string | null;
      assign_to_patient?: boolean;
      user_id?: Types.ObjectId | null;
    } = { ...payload };

    if (payload.referred_doctor_name !== undefined) {
      updatePayload.referred_doctor_name =
        payload.referred_doctor_name?.trim() || null;
    }

    if (payload.assign_to_patient !== undefined) {
      updatePayload.assign_to_patient = payload.assign_to_patient;
      if (payload.assign_to_patient) {
        const consultation = await this.consultationRepository.findOne({
          _id: referral.consultation_id,
        });
        if (!consultation)
          throw new NotFoundException('Consultation not found');
        updatePayload.user_id = consultation.user_id;
      } else {
        updatePayload.user_id = null;
      }
    }

    if (payload.assign_to_patient === true && referral.consultation_id) {
      (updatePayload as Record<string, unknown>).consultation_id =
        this.normalizeConsultationIdRef(referral.consultation_id);
    }

    return this.referralRepository.findOneAndUpdate(
      { _id: referral_id },
      updatePayload,
      { new: true },
    );
  }

  private buildPatientReferralFilter(patient_id: Types.ObjectId) {
    return {
      user_id: patient_id,
      $or: [
        { assign_to_patient: true },
        { assign_to_patient: { $exists: false } },
      ],
    };
  }

  async deleteReferral(referral_id: string, doctor_id: string) {
    const referral = await this.referralRepository.findOne({
      _id: referral_id,
    });
    if (!referral) throw new BadRequestException('Invalid referral id');
    if (referral.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.referralRepository.delete({ _id: referral_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: referral.consultation_id },
      { $pull: { referral_id: referral._id } },
      {},
    );
    return { message: 'Referral deleted successfully' };
  }

  async findPatientReferralsByConsultation(
    patient_id: Types.ObjectId,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
      user_id: patient_id,
    });
    if (!consultation) throw new BadRequestException('Invalid consultation');

    return this.referralRepository
      .model()
      .find({
        consultation_id: this.consultationIdMatch(consultation_id),
        ...this.buildPatientReferralFilter(patient_id),
      })
      .populate('doctor_id', 'full_name first_name last_name specializations')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findAllPatientReferrals(
    patient_id: Types.ObjectId,
    query: { page?: number | string; perPage?: number | string },
  ) {
    const { page, perPage } = query;
    const currentPage = +page || 1;
    const limit = +perPage || 10;

    const filter = this.buildPatientReferralFilter(patient_id);
    const total = await this.referralRepository.model().countDocuments(filter);

    const referrals = await this.referralRepository
      .model()
      .find(filter)
      .populate(
        'consultation_id',
        'title type consoltation_for status session_number createdAt updatedAt',
      )
      .populate(
        'doctor_id',
        'full_name first_name last_name specializations profile_picture_url',
      )
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * limit)
      .limit(limit)
      .exec();

    return {
      referrals,
      meta: {
        total,
        page: currentPage,
        perPage: limit,
        lastPage: total === 0 ? 1 : Math.ceil(total / limit),
      },
    };
  }

  async findGroupedPatientReferrals(patient_id: Types.ObjectId) {
    const referrals = await this.referralRepository
      .model()
      .find(this.buildPatientReferralFilter(patient_id))
      .populate(
        'consultation_id',
        'title type consoltation_for status session_number createdAt updatedAt',
      )
      .populate(
        'doctor_id',
        'full_name first_name last_name specializations profile_picture_url',
      )
      .sort({ createdAt: -1 })
      .exec();

    return this.groupReferralsByConsultation(referrals);
  }

  async findGroupedDoctorReferrals(doctor_id: string) {
    const referrals = await this.referralRepository
      .model()
      .find({ doctor_id })
      .populate(
        'consultation_id',
        'title type consoltation_for status session_number createdAt updatedAt',
      )
      .populate('user_id', 'first_name last_name email phone_number')
      .sort({ createdAt: -1 })
      .exec();

    return this.groupReferralsByConsultation(referrals);
  }

  async findPatientSingleReferral(
    patient_id: Types.ObjectId,
    referral_id: string,
  ) {
    const referral = await this.referralRepository
      .model()
      .findOne({
        _id: referral_id,
        ...this.buildPatientReferralFilter(patient_id),
      })
      .populate('consultation_id', 'title type status createdAt')
      .populate('doctor_id', 'full_name first_name last_name specializations')
      .exec();
    if (!referral) throw new NotFoundException('Referral not found');
    return referral;
  }

  private groupReferralsByConsultation(referrals: any[]) {
    const grouped = new Map<
      string,
      { consultation: any; referrals: any[]; latest_created_at: Date | string }
    >();

    for (const referral of referrals) {
      const consultation = referral.consultation_id;
      const consultationId =
        consultation?._id?.toString?.() ||
        referral.consultation_id?.toString?.();
      if (!consultationId) continue;

      if (!grouped.has(consultationId)) {
        grouped.set(consultationId, {
          consultation,
          referrals: [],
          latest_created_at: referral.createdAt,
        });
      }

      const group = grouped.get(consultationId);
      group.referrals.push(referral);
      if (
        referral.createdAt &&
        new Date(referral.createdAt) > new Date(group.latest_created_at)
      ) {
        group.latest_created_at = referral.createdAt;
      }
    }

    return Array.from(grouped.values())
      .sort(
        (a, b) =>
          new Date(b.latest_created_at).getTime() -
          new Date(a.latest_created_at).getTime(),
      )
      .map(({ latest_created_at, ...group }) => group);
  }

  async deleteMedication(medication_id, doctor_id) {
    const data = await this.medicationRepository.findOne({
      _id: medication_id,
    });
    if (!data) throw new BadRequestException('Invalid medication id');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.medicationRepository.delete({ _id: medication_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: data.consultation_id },
      { $pull: { medication_id: data._id } },
      {},
    );
    return { message: 'Medication deleted successfully' };
  }

  async createCompliantHistory(complaint, patient_id, consultation_id) {
    const data = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!data) throw new BadRequestException('Invalid Consultation');
    if (data.user_id.toString() !== patient_id.toString())
      throw new UnauthorizedException('Invalid User');
    // if(data.status === ConsultationStatusEnum.PENDING) throw new ConflictException("Consultation not Active Yet")
    complaint.user_id = patient_id;
    complaint.doctor_id = data.doctor_id;
    complaint.consultation_id = consultation_id;
    if (!data.doctor_id)
      throw new BadRequestException('Doctor not assigned yet');
    const newComplaint =
      await this.complaintHistoryRepository.create(complaint);
    return newComplaint;
  }

  async getCompliantHistory(patient_id, consultation_id) {
    const data = await this.complaintHistoryRepository.find({
      user_id: patient_id,
    });
    if (!data) throw new BadRequestException('No complaint history found');
    return data;
  }

  async deleteCompliantHistory(complaint_id, patient_id) {
    const data = await this.complaintHistoryRepository.findOne({
      _id: complaint_id,
    });
    if (!data) throw new BadRequestException('Invalid complaint id');
    if (data.user_id.toString() !== patient_id.toString())
      throw new UnauthorizedException('Invalid User');
    await this.complaintHistoryRepository.delete({ _id: complaint_id });
    return { message: 'Complaint history deleted successfully' };
  }

  async getComplaintHistory(doctor_id, consultation_id) {
    const data = await this.complaintHistoryRepository.find({
      doctor_id,
      consultation_id,
    });
    if (!data) throw new BadRequestException('No complaint history found');
    return data;
  }

  async createPhysicalExam(physical_exam, doctor_id, consultation_id) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new NotFoundException('Consultation not found');
    if (consultation.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const existing = await this.physicalExam.findOne({
      consultation_id,
      doctor_id,
    });
    if (existing) {
      throw new ConflictException(
        'Physical exam already exists for this consultation',
      );
    }

    physical_exam.doctor_id = doctor_id;
    physical_exam.consultation_id = consultation_id;
    physical_exam.user_id = consultation.user_id;
    const data = await this.physicalExam.create(physical_exam);

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultation_id },
      { $set: { physical_exam_id: data._id } },
      {},
    );

    return data;
  }

  async updatePhysicalExam(physical_exam_id, physical_exam, doctor_id) {
    const data = await this.physicalExam.findOne({ _id: physical_exam_id });
    if (!data) throw new NotFoundException('Physical exam not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }
    const update = await this.physicalExam.findOneAndUpdate(
      { _id: physical_exam_id },
      { ...physical_exam },
      { new: true },
    );
    return update;
  }

  async getPhysicalExam(doctor_id, consultation_id) {
    const data = await this.physicalExam
      .model()
      .findOne({ doctor_id, consultation_id })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      });
    if (!data)
      throw new NotFoundException(
        'Physical exam not found for this consultation',
      );
    return data;
  }

  async deletePhysicalExam(physical_exam_id: string, doctor_id: string) {
    const data = await this.physicalExam.findOne({ _id: physical_exam_id });
    if (!data) throw new NotFoundException('Physical exam not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.physicalExam.delete({ _id: physical_exam_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: data.consultation_id },
      { $unset: { physical_exam_id: 1 } },
      {},
    );
    return { message: 'Physical exam deleted successfully' };
  }

  async findPatientPhysicalExam(
    patients_id,
    consultation_id,
    query: CoreSearchFilterDatePaginationDto,
  ) {
    const { page, perPage } = query;
    const total = await this.physicalExam
      .model()
      .countDocuments({ user_id: patients_id });
    let physical_exam = await this.physicalExam
      .model()
      .find(
        { user_id: patients_id, consultation_id },
        {},
        { populate: 'consultation_id' },
      )
      .sort({ _id: -1 })
      .skip(((+page || 1) - 1) * (+perPage || 10))
      .limit(+perPage || 10);
    if (!physical_exam) throw new ConflictException('Invalid User');
    return {
      physical_exam,
      meta: {
        total,
        page: +page || 1,
        lastPage: total === 0 ? 1 : Math.ceil(total / (+perPage || 10)),
      },
    };
  }

  async getWeeklyConsultation(doctor_id) {
    const data = await this.consultationRepository
      .model()
      .find({
        doctor_id: doctor_id,
        createdAt: {
          $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
          $lt: new Date(),
        },
      })
      .populate('user_id')
      .populate('doctor_id');
    return data;
  }
  async getWeeklyPatientConsultation(patient_id) {
    const data = await this.consultationRepository
      .model()
      .find({
        user_id: patient_id,
        createdAt: {
          $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
          $lt: new Date(),
        },
      })
      .populate('user_id')
      .populate('doctor_id');
    return data;
  }

  // ─── History Taking CRUD ───────────────────────────

  private async assertDoctorOwnsConsultation(
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }
    if (consultation.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }
    return consultation;
  }

  private resolveHistoryTakingPrefillFromAppointment(appointment: {
    reason_for_visit?: string;
    complaint_brief?: string;
    allergies?: string[];
    booking_profile_snapshot?: {
      present_complaint?: string;
      occupation?: string;
    };
  }): Partial<CreateHistoryTakingDto> {
    const present_complaint =
      appointment.booking_profile_snapshot?.present_complaint?.trim() ||
      appointment.reason_for_visit?.trim() ||
      '';

    return {
      present_complaint,
      ...(appointment.complaint_brief
        ? { history_of_presenting_complaint: appointment.complaint_brief }
        : {}),
      ...(appointment.booking_profile_snapshot?.occupation
        ? { occupation: appointment.booking_profile_snapshot.occupation }
        : {}),
      ...(appointment.allergies?.length
        ? { allergy_history: appointment.allergies }
        : {}),
    };
  }

  private async buildPrefilledHistoryTakingResponse(
    consultation: Consultation,
    doctor_id: string,
    appointment: {
      reason_for_visit?: string;
      complaint_brief?: string;
      allergies?: string[];
      booking_profile_snapshot?: {
        present_complaint?: string;
        occupation?: string;
      };
    },
  ) {
    const consultationWithParticipants = await this.consultationRepository
      .model()
      .findOne({ _id: consultation._id })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      });

    return {
      ...this.resolveHistoryTakingPrefillFromAppointment(appointment),
      status: HistoryTakingStatus.INCOMPLETE,
      user_id: consultationWithParticipants?.user_id ?? consultation.user_id,
      consultation_id: consultation._id,
      doctor_id: consultationWithParticipants?.doctor_id ?? doctor_id,
    };
  }

  async createHistoryTaking(
    dto: CreateHistoryTakingDto,
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.assertDoctorOwnsConsultation(
      doctor_id,
      consultation_id,
    );

    const existing = await this.historyTakingRepository.findOne({
      consultation_id,
      doctor_id,
    });
    if (existing) {
      throw new ConflictException(
        'History taking already exists for this consultation',
      );
    }

    let bookingPrefill: Partial<CreateHistoryTakingDto> = {};
    if (consultation.appointment_id) {
      const appointment = await this.appointmentModel.findById(
        consultation.appointment_id,
      );
      if (appointment) {
        bookingPrefill =
          this.resolveHistoryTakingPrefillFromAppointment(appointment);
      }
    }

    const present_complaint =
      dto.present_complaint?.trim() || bookingPrefill.present_complaint;
    if (!present_complaint) {
      throw new BadRequestException('present_complaint is required');
    }

    const data = await this.historyTakingRepository.create({
      ...bookingPrefill,
      ...dto,
      present_complaint,
      doctor_id,
      consultation_id,
      user_id: consultation.user_id,
    });

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultation_id },
      { $set: { history_taking_id: data._id } },
      {},
    );

    return data;
  }

  async getHistoryTaking(doctor_id: string, consultation_id: string) {
    const data = await this.historyTakingRepository
      .model()
      .findOne({ consultation_id, doctor_id })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      });
    if (data) {
      return data;
    }

    const consultation = await this.assertDoctorOwnsConsultation(
      doctor_id,
      consultation_id,
    );

    if (!consultation.appointment_id) {
      throw new NotFoundException(
        'History taking not found for this consultation',
      );
    }

    const appointment = await this.appointmentModel.findById(
      consultation.appointment_id,
    );
    if (!appointment) {
      throw new NotFoundException(
        'History taking not found for this consultation',
      );
    }

    return this.buildPrefilledHistoryTakingResponse(
      consultation,
      doctor_id,
      appointment,
    );
  }

  async updateHistoryTaking(
    history_taking_id: string,
    dto: UpdateHistoryTakingDto,
    doctor_id: string,
  ) {
    const data = await this.historyTakingRepository.findOne({
      _id: history_taking_id,
    });
    if (!data) throw new NotFoundException('History taking not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const updated = await this.historyTakingRepository.findOneAndUpdate(
      { _id: history_taking_id },
      { ...dto },
      { new: true },
    );
    return updated;
  }

  async deleteHistoryTaking(history_taking_id: string, doctor_id: string) {
    const data = await this.historyTakingRepository.findOne({
      _id: history_taking_id,
    });
    if (!data) throw new NotFoundException('History taking not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.historyTakingRepository.delete({ _id: history_taking_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: data.consultation_id },
      { $unset: { history_taking_id: 1 } },
      {},
    );
    return { message: 'History taking deleted successfully' };
  }

  // ─── Investigation Result CRUD ─────────────────────

  async createInvestigationForm(
    dto: CreateInvestigationFormDto,
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new NotFoundException('Consultation not found');
    if (consultation.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const existing = await this.investigationFormRepository.findOne({
      consultation_id,
      doctor_id,
    });
    if (existing) {
      throw new ConflictException(
        'Investigation result already exists for this consultation',
      );
    }

    const data = await this.investigationFormRepository.create({
      ...dto,
      doctor_id,
      consultation_id,
      user_id: consultation.user_id,
    });

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultation_id },
      { $set: { investigation_result_id: data._id } },
      {},
    );

    return data;
  }

  async getInvestigationForm(doctor_id: string, consultation_id: string) {
    const data = await this.investigationFormRepository
      .model()
      .findOne({ consultation_id, doctor_id })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      });
    if (!data)
      throw new NotFoundException(
        'Investigation result not found for this consultation',
      );
    return data;
  }

  async updateInvestigationForm(
    investigation_form_id: string,
    dto: UpdateInvestigationFormDto,
    doctor_id: string,
  ) {
    const data = await this.investigationFormRepository.findOne({
      _id: investigation_form_id,
    });
    if (!data) throw new NotFoundException('Investigation result not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const updated = await this.investigationFormRepository.findOneAndUpdate(
      { _id: investigation_form_id },
      { ...dto },
      { new: true },
    );
    return updated;
  }

  async deleteInvestigationForm(
    investigation_form_id: string,
    doctor_id: string,
  ) {
    const data = await this.investigationFormRepository.findOne({
      _id: investigation_form_id,
    });
    if (!data) throw new NotFoundException('Investigation result not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.investigationFormRepository.delete({
      _id: investigation_form_id,
    });
    await this.consultationRepository.findOneAndUpdate(
      { _id: data.consultation_id },
      { $unset: { investigation_result_id: 1 } },
      {},
    );
    return { message: 'Investigation result deleted successfully' };
  }

  // ─── Investigation List CRUD ──────────────────────

  private normalizeInvestigationIdentity(
    category?: string | null,
    testRequested?: string | null,
    legacyName?: string | null,
  ) {
    const test = (testRequested || legacyName || '').trim().toLowerCase();
    const normalizedCategory = (category || 'Other').trim().toLowerCase();
    return `${normalizedCategory}::${test}`;
  }

  private async assertNoPendingInvestigationDuplicate(
    consultation_id: string,
    item: { category: string; test_requested: string },
  ) {
    const incomingKey = this.normalizeInvestigationIdentity(
      item.category,
      item.test_requested,
    );

    const pending = await this.investigationListRepository.model().find({
      consultation_id,
      assign_to_patient: false,
    });

    const duplicate = pending.find(
      (record) =>
        this.normalizeInvestigationIdentity(
          record.category,
          record.test_requested,
          record.name,
        ) === incomingKey,
    );

    if (duplicate) {
      throw new ConflictException(
        `Investigation "${item.test_requested}" is already saved for this consultation and has not been sent to the patient yet.`,
      );
    }
  }

  async createInvestigationList(
    dto: CreateInvestigationListDto,
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new NotFoundException('Consultation not found');
    if (consultation.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const assignToPatient = dto.assign_to_patient === true;
    const seenInRequest = new Set<string>();

    for (const item of dto.investigations) {
      const requestKey = this.normalizeInvestigationIdentity(
        item.category,
        item.test_requested,
      );

      if (seenInRequest.has(requestKey)) {
        throw new ConflictException(
          `Duplicate investigation "${item.test_requested}" in this request.`,
        );
      }
      seenInRequest.add(requestKey);

      await this.assertNoPendingInvestigationDuplicate(consultation_id, item);
    }

    const data = await Promise.all(
      dto.investigations.map((item) =>
        this.investigationListRepository.create({
          name: item.test_requested,
          category: item.category,
          test_requested: item.test_requested,
          priority: item.priority,
          specimen: item.specimen ?? '-',
          assign_to_patient: assignToPatient,
          doctor_id,
          consultation_id,
          user_id: assignToPatient ? consultation.user_id : null,
        }),
      ),
    );

    return data;
  }

  async getInvestigationListsByConsultation(
    doctor_id: string,
    consultation_id: string,
  ) {
    const data = await this.investigationListRepository
      .model()
      .find({ consultation_id, doctor_id })
      .sort({ createdAt: -1 })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      });
    return data;
  }

  async getInvestigationListById(
    investigation_list_id: string,
    doctor_id: string,
  ) {
    const data = await this.investigationListRepository.findOne({
      _id: investigation_list_id,
    });
    if (!data) throw new NotFoundException('Investigation list not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }
    return data;
  }

  async updateInvestigationList(
    investigation_list_id: string,
    dto: UpdateInvestigationListDto,
    doctor_id: string,
  ) {
    const data = await this.investigationListRepository.findOne({
      _id: investigation_list_id,
    });
    if (!data) throw new NotFoundException('Investigation list not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const updatePayload: Record<string, any> = {};
    if (dto.category !== undefined) updatePayload.category = dto.category;
    if (dto.test_requested !== undefined) {
      updatePayload.test_requested = dto.test_requested;
      updatePayload.name = dto.test_requested;
    }
    if (dto.priority !== undefined) updatePayload.priority = dto.priority;
    if (dto.specimen !== undefined) updatePayload.specimen = dto.specimen;

    if (dto.assign_to_patient !== undefined) {
      updatePayload.assign_to_patient = dto.assign_to_patient;
      if (dto.assign_to_patient) {
        const consultation = await this.consultationRepository.findOne({
          _id: data.consultation_id,
        });
        if (!consultation)
          throw new NotFoundException('Consultation not found');
        updatePayload.user_id = consultation.user_id;
      } else {
        updatePayload.user_id = null;
      }
    }

    const updated = await this.investigationListRepository.findOneAndUpdate(
      { _id: investigation_list_id },
      updatePayload,
      { new: true },
    );
    return updated;
  }

  async deleteInvestigationList(
    investigation_list_id: string,
    doctor_id: string,
  ) {
    const data = await this.investigationListRepository.findOne({
      _id: investigation_list_id,
    });
    if (!data) throw new NotFoundException('Investigation list not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.investigationListRepository.delete({
      _id: investigation_list_id,
    });
    return { message: 'Investigation list deleted successfully' };
  }

  // ─── Treatment Plan CRUD ───────────────────────────

  async createTreatmentPlan(
    dto: CreateTreatmentPlanDto,
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new NotFoundException('Consultation not found');
    if (consultation.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const existing = await this.treatmentPlanRepository.findOne({
      consultation_id,
      doctor_id,
    });
    if (existing) {
      throw new ConflictException(
        'Treatment plan already exists for this consultation',
      );
    }

    const data = await this.treatmentPlanRepository.create({
      ...dto,
      doctor_id,
      consultation_id,
      user_id: consultation.user_id,
    });

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultation_id },
      { $set: { treatment_plan_id: data._id } },
      {},
    );

    return data;
  }

  async getTreatmentPlan(doctor_id: string, consultation_id: string) {
    const data = await this.treatmentPlanRepository
      .model()
      .findOne({ consultation_id, doctor_id })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      });
    if (!data)
      throw new NotFoundException(
        'Treatment plan not found for this consultation',
      );
    return data;
  }

  async updateTreatmentPlan(
    treatment_plan_id: string,
    dto: UpdateTreatmentPlanDto,
    doctor_id: string,
  ) {
    const data = await this.treatmentPlanRepository.findOne({
      _id: treatment_plan_id,
    });
    if (!data) throw new NotFoundException('Treatment plan not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const updated = await this.treatmentPlanRepository.findOneAndUpdate(
      { _id: treatment_plan_id },
      { ...dto },
      { new: true },
    );
    return updated;
  }

  async deleteTreatmentPlan(treatment_plan_id: string, doctor_id: string) {
    const data = await this.treatmentPlanRepository.findOne({
      _id: treatment_plan_id,
    });
    if (!data) throw new NotFoundException('Treatment plan not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.treatmentPlanRepository.delete({ _id: treatment_plan_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: data.consultation_id },
      { $unset: { treatment_plan_id: 1 } },
      {},
    );
    return { message: 'Treatment plan deleted successfully' };
  }

  // ─── Diagnosis Form CRUD ───────────────────────────

  async createDiagnosisForm(
    dto: CreateDiagnosisFormDto,
    doctor_id: string,
    consultation_id: string,
  ) {
    const consultation = await this.consultationRepository.findOne({
      _id: consultation_id,
    });
    if (!consultation) throw new NotFoundException('Consultation not found');
    if (consultation.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const existing = await this.diagnosisFormRepository.findOne({
      consultation_id,
      doctor_id,
    });
    if (existing) {
      throw new ConflictException(
        'Diagnosis form already exists for this consultation',
      );
    }

    const data = await this.diagnosisFormRepository.create({
      ...dto,
      doctor_id,
      consultation_id,
      user_id: consultation.user_id,
    });

    await this.consultationRepository.findOneAndUpdate(
      { _id: consultation_id },
      { $set: { diagnosis_form_id: data._id } },
      {},
    );

    return data;
  }

  async getDiagnosisForm(doctor_id: string, consultation_id: string) {
    const data = await this.diagnosisFormRepository
      .model()
      .findOne({ consultation_id, doctor_id })
      .populate({
        path: 'user_id',
        select:
          'first_name last_name full_name email phone_number gender date_of_birth profile_picture_url',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      });
    if (!data)
      throw new NotFoundException(
        'Diagnosis form not found for this consultation',
      );
    return data;
  }

  async updateDiagnosisForm(
    diagnosis_form_id: string,
    dto: UpdateDiagnosisFormDto,
    doctor_id: string,
  ) {
    const data = await this.diagnosisFormRepository.findOne({
      _id: diagnosis_form_id,
    });
    if (!data) throw new NotFoundException('Diagnosis form not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    const updated = await this.diagnosisFormRepository.findOneAndUpdate(
      { _id: diagnosis_form_id },
      { ...dto },
      { new: true },
    );
    return updated;
  }

  async deleteDiagnosisForm(diagnosis_form_id: string, doctor_id: string) {
    const data = await this.diagnosisFormRepository.findOne({
      _id: diagnosis_form_id,
    });
    if (!data) throw new NotFoundException('Diagnosis form not found');
    if (data.doctor_id.toString() !== doctor_id.toString()) {
      throw new UnauthorizedException(
        'You are not authorized to perform this action',
      );
    }

    await this.diagnosisFormRepository.delete({ _id: diagnosis_form_id });
    await this.consultationRepository.findOneAndUpdate(
      { _id: data.consultation_id },
      { $unset: { diagnosis_form_id: 1 } },
      {},
    );
    return { message: 'Diagnosis form deleted successfully' };
  }

  async getPatientMedicalHistory(patient_id: string) {
    const consultations = await this.consultationRepository
      .model()
      .find({ user_id: new Types.ObjectId(patient_id) })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      })
      .populate({
        path: 'appointment_id',
        select:
          'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit timezone_snapshot',
      })
      .populate({
        path: 'medication_id',
        select:
          'formulary medication dose unit interval duration duration_unit status createdAt updatedAt',
      })
      .populate({
        path: 'investigation_id',
        select: 'name file status createdAt updatedAt',
      })
      .populate({
        path: 'diagnosis_id',
        select: 'title description status createdAt updatedAt',
      })
      .populate({ path: 'history_taking_id' })
      .populate({ path: 'investigation_result_id' })
      .sort({ createdAt: -1 });

    return consultations;
  }

  async getPatientConsultationHistory(patient_id: string) {
    const uid = new Types.ObjectId(patient_id);
    return this.consultationRepository
      .model()
      .find({ user_id: uid })
      .select(
        '_id title type consoltation_for status session_number createdAt updatedAt',
      )
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name specializations profile_picture_url',
      })
      .populate({
        path: 'appointment_id',
        select:
          'appointment_number scheduled_start_at_utc scheduled_end_at_utc status reason_for_visit',
      })
      .sort({ createdAt: -1 })
      .limit(5);
  }

  async getPatientMedicationHistory(patient_id: string) {
    const uid = new Types.ObjectId(patient_id);
    return this.medicationRepository
      .model()
      .find({ user_id: uid })
      .populate({
        path: 'consultation_id',
        select: 'title type status createdAt',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name specializations profile_picture_url',
      })
      .sort({ createdAt: -1 })
      .limit(5);
  }

  async getPatientDiagnosisHistory(patient_id: string) {
    const uid = new Types.ObjectId(patient_id);
    return this.diagnosisFormRepository
      .model()
      .find({ user_id: uid })
      .populate({
        path: 'consultation_id',
        select: 'title type status createdAt',
      })
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name specializations profile_picture_url',
      })
      .sort({ createdAt: -1 })
      .limit(5);
  }

  async getPatientInvestigationListsGroupedByConsultation(
    patient_id: string,
    page = 1,
    perPage = 20,
  ) {
    const uid = new Types.ObjectId(patient_id);
    const safePage = Math.max(1, page);
    const safePerPage = Math.min(Math.max(1, perPage), 100);

    const doctorProjection = {
      first_name: 1,
      last_name: 1,
      full_name: 1,
      email: 1,
      specializations: 1,
      profile_picture_url: 1,
    };

    const [result] = await this.investigationListRepository.model().aggregate([
      { $match: { user_id: uid, assign_to_patient: true } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'doctors',
          localField: 'doctor_id',
          foreignField: '_id',
          as: 'doctor_id',
          pipeline: [{ $project: doctorProjection }],
        },
      },
      { $unwind: { path: '$doctor_id', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$consultation_id',
          investigations: { $push: '$$ROOT' },
          investigation_count: { $sum: 1 },
          latest_created_at: { $max: '$createdAt' },
        },
      },
      { $sort: { latest_created_at: -1 } },
      {
        $facet: {
          data: [
            { $skip: (safePage - 1) * safePerPage },
            { $limit: safePerPage },
            {
              $addFields: {
                consultation_lookup_id: {
                  $convert: {
                    input: '$_id',
                    to: 'objectId',
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $lookup: {
                from: 'consultations',
                localField: 'consultation_lookup_id',
                foreignField: '_id',
                as: 'consultation',
                pipeline: [
                  {
                    $lookup: {
                      from: 'doctors',
                      localField: 'doctor_id',
                      foreignField: '_id',
                      as: 'doctor_id',
                      pipeline: [{ $project: doctorProjection }],
                    },
                  },
                  {
                    $unwind: {
                      path: '$doctor_id',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $lookup: {
                      from: 'appointments',
                      localField: 'appointment_id',
                      foreignField: '_id',
                      as: 'appointment_id',
                      pipeline: [
                        {
                          $project: {
                            appointment_number: 1,
                            scheduled_start_at_utc: 1,
                            scheduled_end_at_utc: 1,
                            status: 1,
                            reason_for_visit: 1,
                          },
                        },
                      ],
                    },
                  },
                  {
                    $unwind: {
                      path: '$appointment_id',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $project: {
                      title: 1,
                      type: 1,
                      consoltation_for: 1,
                      status: 1,
                      session_number: 1,
                      consultation_id: 1,
                      createdAt: 1,
                      updatedAt: 1,
                      doctor_id: 1,
                      appointment_id: 1,
                    },
                  },
                ],
              },
            },
            {
              $unwind: {
                path: '$consultation',
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 0,
                consultation: { $ifNull: ['$consultation', null] },
                investigation_count: 1,
                investigations: 1,
              },
            },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ]);

    const total = result?.meta?.[0]?.total ?? 0;
    const totalPages = total === 0 ? 1 : Math.ceil(total / safePerPage);

    return {
      groups: result?.data ?? [],
      pagination: {
        total,
        page: safePage,
        perPage: safePerPage,
        total_pages: totalPages,
      },
    };
  }

  async getPatientInvestigationListsByConsultation(
    patient_id: string,
    consultation_id: string,
  ) {
    const uid = new Types.ObjectId(patient_id);
    const consultationObjectId = Types.ObjectId.isValid(consultation_id)
      ? new Types.ObjectId(consultation_id)
      : null;

    const consultationMatch = consultationObjectId
      ? {
          $or: [{ consultation_id }, { consultation_id: consultationObjectId }],
        }
      : { consultation_id };

    const doctorProjection = {
      first_name: 1,
      last_name: 1,
      full_name: 1,
      email: 1,
      specializations: 1,
      profile_picture_url: 1,
    };

    const investigations = await this.investigationListRepository
      .model()
      .aggregate([
        {
          $match: {
            user_id: uid,
            assign_to_patient: true,
            ...consultationMatch,
          },
        },
        {
          $addFields: {
            consultation_lookup_id: {
              $convert: {
                input: '$consultation_id',
                to: 'objectId',
                onError: null,
                onNull: null,
              },
            },
          },
        },
        {
          $lookup: {
            from: 'doctors',
            localField: 'doctor_id',
            foreignField: '_id',
            as: 'doctor_id',
            pipeline: [{ $project: doctorProjection }],
          },
        },
        { $unwind: { path: '$doctor_id', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'consultations',
            localField: 'consultation_lookup_id',
            foreignField: '_id',
            as: 'consultation',
            pipeline: [
              {
                $project: {
                  title: 1,
                  type: 1,
                  consoltation_for: 1,
                  status: 1,
                  session_number: 1,
                  consultation_id: 1,
                  createdAt: 1,
                  updatedAt: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: { path: '$consultation', preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            consultation_id: { $ifNull: ['$consultation', '$consultation_id'] },
          },
        },
        {
          $project: {
            consultation_lookup_id: 0,
            consultation: 0,
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

    return {
      consultation: investigations?.[0]?.consultation_id ?? null,
      investigation_count: investigations.length,
      investigations,
    };
  }

  async uploadInvestigationListImages(
    patient_id: string,
    investigation_list_id: string,
    files: any[],
  ) {
    if (!Types.ObjectId.isValid(investigation_list_id)) {
      throw new BadRequestException('Invalid investigation list id');
    }

    const uid = new Types.ObjectId(patient_id);
    const invId = new Types.ObjectId(investigation_list_id);

    const investigation = await this.investigationListRepository.findOne({
      _id: invId,
    });
    if (!investigation) {
      throw new NotFoundException('Investigation not found');
    }
    if (
      !investigation.user_id ||
      investigation.user_id.toString() !== uid.toString()
    ) {
      throw new UnauthorizedException(
        'This investigation is not assigned to you',
      );
    }

    const imageUrls = await Promise.all(
      files.map((file) =>
        this.cloudinaryService.uploadInvestigationImage(
          file,
          patient_id,
          investigation_list_id,
        ),
      ),
    );

    const updated = await this.investigationListRepository
      .model()
      .findOneAndUpdate(
        { _id: invId },
        { $push: { result_images: { $each: imageUrls } } },
        { new: true },
      )
      .populate({
        path: 'doctor_id',
        select:
          'first_name last_name full_name email specializations profile_picture_url',
      })
      .populate({
        path: 'consultation_id',
        select:
          'title type consoltation_for status session_number createdAt updatedAt',
      });

    return updated;
  }
}

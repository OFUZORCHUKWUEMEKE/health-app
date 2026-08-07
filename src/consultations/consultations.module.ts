import { Module } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CompliantHistorySchema,
  ConsultationSchema,
  DiagnosisSchema,
  HistoryTakingSchema,
  DiagnosisFormSchema,
  InvestigationResultSchema,
  InvestigationSchema,
  InvestigationListSchema,
  MedicationSchema,
  PhysicalExamSchema,
  ReferralSchema,
  TreatmentPlanSchema,
} from './consultations.model';
import { AuthModule } from 'src/auth/auth.module';
import { ConsultationRepository } from './consultations.repository';
import { DoctorsModule } from 'src/doctors/doctors.module';
import { ConsultationFactory } from './consultation.factory';
import { UsersModule } from 'src/users/users.module';
import { InvestigationRepository } from './investigation.repository';
import { DiagnosisRepository } from './diagnosis.repository';
import { PatientsController } from './controllers/patients.controller';
import { DoctorsController } from './controllers/doctors.controller';
import { MedicationRepository } from './medication.repository';
import { ReferralRepository } from './referral.repository';
import { ComplaintHistoryRepository } from './compliant-history.repository';
import { PhysicalExamsRepository } from './physical-exams.repository';
import { HistoryTakingRepository } from './history-taking.repository';
import { InvestigationFormRepository } from './investigation-form.repository';
import { TreatmentPlanRepository } from './treatment-plan.repository';
import { DiagnosisFormRepository } from './diagnosis-form.repository';
import { Appointment, AppointmentSchema } from 'src/bookings/models/appointment.model';
import { InvestigationListRepository } from './investigation-list.repository';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Consultation', schema: ConsultationSchema },
      { name: 'Investigation', schema: InvestigationSchema },
      { name: 'Diagnosis', schema: DiagnosisSchema },
      { name: 'Medication', schema: MedicationSchema },
      { name: 'Referral', schema: ReferralSchema },
      { name: 'CompliantHistory', schema: CompliantHistorySchema },
      { name: 'PhysicalExam', schema: PhysicalExamSchema },
      { name: 'HistoryTaking', schema: HistoryTakingSchema },
      { name: 'InvestigationResult', schema: InvestigationResultSchema },
      { name: 'InvestigationList', schema: InvestigationListSchema },
      { name: 'TreatmentPlan', schema: TreatmentPlanSchema },
      { name: 'DiagnosisForm', schema: DiagnosisFormSchema },
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
    AuthModule,
    DoctorsModule,
    UsersModule,
    CloudinaryModule,
  ],
  controllers: [PatientsController, DoctorsController],
  providers: [
    ConsultationsService,
    ConsultationRepository,
    ConsultationFactory,
    InvestigationRepository,
    DiagnosisRepository,
    MedicationRepository,
    ReferralRepository,
    ComplaintHistoryRepository,
    PhysicalExamsRepository,
    HistoryTakingRepository,
    InvestigationFormRepository,
    InvestigationListRepository,
    TreatmentPlanRepository,
    DiagnosisFormRepository,
  ],
  exports: [ConsultationsService, ConsultationRepository, InvestigationRepository],
})
export class ConsultationsModule { }

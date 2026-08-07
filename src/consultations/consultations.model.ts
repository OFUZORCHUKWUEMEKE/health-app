// src/consultation/consultation.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { IsString, IsEnum } from 'class-validator';
import {
  ConsultationTypeEnum,
  ConsultationForEnum,
  ConsultationStatusEnum,
  MedicationFormulation,
  MedicationDoseUnit,
  MedicationInterval,
  MedicationDurationUnit,
  STATUS,
} from './consultations.enums';

export type ConsultationDocument = Consultation & Document;

@Schema({ timestamps: true })
export class Consultation extends Document {
  _id: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'Appointment',
    index: true,
    sparse: true,
    unique: true,
  })
  appointment_id?: Types.ObjectId;

  @Prop({ required: true, enum: ConsultationTypeEnum })
  @IsEnum(ConsultationTypeEnum)
  type: ConsultationTypeEnum;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  @IsString()
  user_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Doctor' })
  @IsString()
  doctor_id: Types.ObjectId;

  @Prop({ required: true, enum: ConsultationForEnum })
  @IsEnum(ConsultationForEnum)
  consoltation_for: ConsultationForEnum;

  @Prop({ required: false })
  consultation_id: string;

  @Prop({ required: true })
  @IsString()
  title: string;

  @Prop()
  @IsString()
  details: string;

  @Prop()
  @IsString()
  session_number: string;

  @Prop()
  parent_consultation_id: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Medication' }], default: [] })
  medication_id?: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Investigation' }], default: [] })
  investigation_id?: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Diagnosis' }], default: [] })
  diagnosis_id?: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Referral' }], default: [] })
  referral_id?: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'HistoryTaking' })
  history_taking_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PhysicalExam' })
  physical_exam_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InvestigationResult' })
  investigation_result_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'TreatmentPlan' })
  treatment_plan_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DiagnosisForm' })
  diagnosis_form_id?: Types.ObjectId;

  @Prop()
  @IsString()
  treatment_plan: string;

  @Prop({
    enum: ConsultationStatusEnum,
    default: ConsultationStatusEnum.PENDING,
  })
  @IsEnum(ConsultationStatusEnum)
  status: ConsultationStatusEnum;
}

export const ConsultationSchema = SchemaFactory.createForClass(Consultation);
ConsultationSchema.index({ user_id: 1, status: 1 });
ConsultationSchema.index({ doctor_id: 1, status: 1 });

export type InvestigationDocument = Investigation & Document;

@Schema({ timestamps: true })
export class Investigation extends Document {
  // Mongoose will automatically handle _id as ObjectId, no need to explicitly define it
  // If you specifically want a string ID with auto-increment, we'll need a different approach

  @Prop({ required: true })
  name: string;

  @Prop({ required: false })
  file: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Consultation', required: true })
  consultation_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Doctor', required: true })
  doctor_id: Types.ObjectId;

  @Prop({
    type: String,
    enum: ConsultationStatusEnum,
    default: ConsultationStatusEnum.PENDING,
  })
  status: ConsultationStatusEnum;
}

export const InvestigationSchema = SchemaFactory.createForClass(Investigation);
InvestigationSchema.index({ user_id: 1, file: 1 });
InvestigationSchema.index({ doctor_id: 1, status: 1 });

export type DiagnosisDocument = Diagnosis & Document;

@Schema({ timestamps: true }) // Adds createdAt and updatedAt fields
export class Diagnosis extends Document {
  // _id is automatically provided by Mongoose as ObjectId, no need to define explicitly
  @Prop({ required: true, type: String })
  title: string;

  @Prop({ type: String })
  description: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;

  @Prop({ enum: ['COMPLETED', 'INCOMPLETE'], default: 'INCOMPLETE' })
  status: string;
}

export const DiagnosisSchema = SchemaFactory.createForClass(Diagnosis);

export type MedicationDocument = Medication & Document;

@Schema({ timestamps: true })
export class Medication extends Document {
  @Prop({ required: true, enum: MedicationFormulation })
  formulary: MedicationFormulation;

  @Prop({ required: true })
  medication: string;

  @Prop({ required: true })
  dose: number;

  @Prop({ required: true, enum: MedicationDoseUnit })
  unit: MedicationDoseUnit;

  @Prop({ required: true, enum: MedicationInterval })
  interval: MedicationInterval;

  @Prop({ required: true })
  duration: number;

  @Prop({ required: true, enum: MedicationDurationUnit })
  duration_unit: MedicationDurationUnit;

  @Prop({ type: String, default: null })
  order_instruction: string | null;

  @Prop({ type: String, default: null })
  start_date: string | null;

  @Prop({ default: false })
  assign_to_patient: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;

  @Prop({ required: true, enum: STATUS, default: STATUS.ACTIVE })
  status: STATUS;
}

export const MedicationSchema = SchemaFactory.createForClass(Medication);
MedicationSchema.index({ user_id: 1, consultation_id: 1 });
MedicationSchema.index({ consultation_id: 1, user_id: 1 });
MedicationSchema.index({ doctor_id: 1, assign_to_patient: 1 });

export type CompliantHistoryDocument = CompliantHistory & Document;

@Schema({ timestamps: true })
export class CompliantHistory extends Document {
  @Prop({ required: true })
  past_medical_history: string;

  @Prop({ required: false })
  medication: string;

  @Prop({ required: false })
  allergy: string;

  @Prop({ required: false })
  family: string;

  @Prop({ required: false })
  travel: string;

  @Prop({ required: false })
  occupation: string;

  @Prop({ required: false })
  social: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;
}

export const CompliantHistorySchema =
  SchemaFactory.createForClass(CompliantHistory);

export enum PhysicalExamStatus {
  COMPLETED = 'COMPLETED',
  INCOMPLETE = 'INCOMPLETE',
}

export type PhysicalExamDocument = PhysicalExam & Document;

@Schema({ timestamps: true })
export class PhysicalExam extends Document {
  @Prop()
  general_physical: string;

  @Prop()
  nervous_system: string;

  @Prop()
  respiratory_system: string;

  @Prop()
  cardiovascular_system: string;

  @Prop()
  gastrointestinal_system: string;

  @Prop()
  genitourinary_system: string;

  @Prop()
  musculoskeletal_system: string;

  @Prop()
  ENT: string;

  @Prop()
  obstetric_gynaecological: string;

  @Prop()
  others: string;

  @Prop({ enum: PhysicalExamStatus, default: PhysicalExamStatus.INCOMPLETE })
  status: PhysicalExamStatus;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;
}

export const PhysicalExamSchema = SchemaFactory.createForClass(PhysicalExam);

export enum HistoryTakingStatus {
  COMPLETED = 'COMPLETED',
  INCOMPLETE = 'INCOMPLETE',
}

export type HistoryTakingDocument = HistoryTaking & Document;

@Schema({ timestamps: true })
export class HistoryTaking extends Document {
  @Prop({ required: true })
  present_complaint: string;

  @Prop()
  history_of_presenting_complaint: string;

  @Prop()
  past_medical_surgical_history: string;

  @Prop()
  medication_history: string;

  @Prop({ type: [String], default: [] })
  allergy_history: string[];

  @Prop()
  family_history: string;

  @Prop()
  travel_history: string;

  @Prop()
  occupation: string;

  @Prop()
  social_history: string;

  @Prop()
  obstetric_gynaecological_history: string;

  @Prop({ enum: HistoryTakingStatus, default: HistoryTakingStatus.INCOMPLETE })
  status: HistoryTakingStatus;

  @Prop()
  others: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;
}

export const HistoryTakingSchema = SchemaFactory.createForClass(HistoryTaking);

export enum InvestigationResultStatus {
  COMPLETED = 'COMPLETED',
  INCOMPLETE = 'INCOMPLETE',
}

export type InvestigationResultDocument = InvestigationResult & Document;

@Schema({ timestamps: true })
export class InvestigationResult extends Document {
  @Prop()
  blood_test: string;

  @Prop()
  microbiology: string;

  @Prop()
  radiology: string;

  @Prop()
  cardiovascular: string;

  @Prop()
  procedures: string;

  @Prop()
  others: string;

  @Prop({
    enum: InvestigationResultStatus,
    default: InvestigationResultStatus.INCOMPLETE,
  })
  status: InvestigationResultStatus;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;
}

export const InvestigationResultSchema =
  SchemaFactory.createForClass(InvestigationResult);

export type InvestigationListDocument = InvestigationList & Document;

@Schema({ timestamps: true })
export class InvestigationList extends Document {
  @Prop({ required: true, type: String })
  name: string;

  @Prop({ type: String, default: null })
  category: string | null;

  @Prop({ type: String, default: null })
  test_requested: string | null;

  @Prop({ type: String, default: 'Routine' })
  priority: string;

  @Prop({ type: String, default: '-' })
  specimen: string;

  @Prop({ default: false })
  assign_to_patient: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  user_id: Types.ObjectId | null;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  result_images: string[];
}

export const InvestigationListSchema =
  SchemaFactory.createForClass(InvestigationList);
InvestigationListSchema.index({ user_id: 1, assign_to_patient: 1 });
InvestigationListSchema.index({ doctor_id: 1, assign_to_patient: 1 });

export enum TreatmentPlanStatus {
  COMPLETED = 'COMPLETED',
  INCOMPLETE = 'INCOMPLETE',
}

export type TreatmentPlanDocument = TreatmentPlan & Document;

@Schema({ timestamps: true })
export class TreatmentPlan extends Document {
  @Prop()
  treatment_plan_details: string;

  @Prop({ enum: TreatmentPlanStatus, default: TreatmentPlanStatus.INCOMPLETE })
  status: TreatmentPlanStatus;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;
}

export const TreatmentPlanSchema = SchemaFactory.createForClass(TreatmentPlan);

export enum DiagnosisFormStatus {
  COMPLETED = 'COMPLETED',
  INCOMPLETE = 'INCOMPLETE',
}

export type DiagnosisFormDocument = DiagnosisForm & Document;

@Schema({ timestamps: true })
export class DiagnosisForm extends Document {
  @Prop({ type: [String], default: [] })
  provisional_diagnosis: string[];

  @Prop({ type: [String], default: [] })
  final_diagnosis: string[];

  @Prop({ enum: DiagnosisFormStatus, default: DiagnosisFormStatus.INCOMPLETE })
  status: DiagnosisFormStatus;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;
}

export const DiagnosisFormSchema = SchemaFactory.createForClass(DiagnosisForm);

export type ReferralDocument = Referral & Document;

@Schema({ timestamps: true })
export class Referral extends Document {
  @Prop({ type: String, default: null })
  referred_doctor_name: string | null;

  @Prop({ required: true })
  specialist_name: string;

  @Prop({ required: true })
  hospital: string;

  @Prop({ required: true })
  referral_details: string;

  @Prop({ default: false })
  assign_to_patient: boolean;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Consultation' })
  consultation_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  user_id: Types.ObjectId | null;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Doctor' })
  doctor_id: Types.ObjectId;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);
ReferralSchema.index({ user_id: 1, assign_to_patient: 1 });
ReferralSchema.index({ doctor_id: 1, assign_to_patient: 1 });
ReferralSchema.index({ consultation_id: 1, assign_to_patient: 1 });

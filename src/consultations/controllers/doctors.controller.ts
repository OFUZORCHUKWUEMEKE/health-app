import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CoreController } from 'src/common/core/controller.core';
import { DoctorGuard } from 'src/auth/guard/doctor.guard';
import { GeneralGuard } from 'src/auth/guard/general.guard';
import { ConsultationsService } from '../consultations.service';
import { CreateConsultationDto } from '../dto/create-consultation.dto';
import { DiagnosisDto } from '../dto/create-dignosis.dto';
import { InvestigationDto } from '../dto/create-investigation.dto';
import { CoreSearchFilterDatePaginationDto } from 'src/common/core/dto.core';
import {
  CreateMedicationDto,
  UpdateMedicationDto,
} from '../dto/create-medication';
import {
  CreatePhysicalExamDto,
  UpdatePhysicalExamDto,
} from '../dto/create-physical-exam.dto';
import {
  CreateHistoryTakingDto,
  UpdateHistoryTakingDto,
} from '../dto/create-history-taking.dto';
import {
  CreateInvestigationFormDto,
  UpdateInvestigationFormDto,
} from '../dto/create-investigation-result.dto';
import {
  CreateTreatmentPlanDto,
  UpdateTreatmentPlanDto,
} from '../dto/create-treatment-plan.dto';
import {
  CreateDiagnosisFormDto,
  UpdateDiagnosisFormDto,
} from '../dto/create-diagnosis-form.dto';
import {
  CreateInvestigationListDto,
  UpdateInvestigationListDto,
} from '../dto/create-investigation-list.dto';
import {
  CreateReferralDto,
  UpdateReferralDto,
} from '../dto/create-referral.dto';

const referralRequestExample = {
  referred_doctor_name: 'Dr. Adebayo Okonkwo',
  specialist_name: 'Cardiologist',
  hospital: 'Lagos University Teaching Hospital',
  referral_details:
    'Patient presents with persistent chest pain. Please evaluate for cardiac involvement.',
  assign_to_patient: false,
};

const referralResponseExample = {
  _id: '64f3ref000bbb222',
  ...referralRequestExample,
  consultation_id: '64f3abc000aaa111',
  user_id: '64f3pat000ccc333',
  doctor_id: '64f3doc000ddd444',
  createdAt: '2026-04-21T10:00:00.000Z',
  updatedAt: '2026-04-21T10:00:00.000Z',
};

const medicationRequestExample = {
  prescriptions: [
    {
      formulary: 'TABLET',
      medication: 'Paracetamol',
      dose: 500,
      unit: 'MILLIGRAM',
      interval: 'DAILY',
      duration: 5,
      duration_unit: 'DAY',
    },
    {
      formulary: 'SYRUP',
      medication: 'Cough Syrup',
      dose: 10,
      unit: 'MLS',
      interval: 'DAILY',
      duration: 7,
      duration_unit: 'DAY',
    },
  ],
};

const medicationResponseExample = {
  _id: '69cd4d043e2fbcfe64995e77',
  prescriptions: medicationRequestExample.prescriptions,
  user_id: '69b352fd0198015c43f6db1e',
  consultation_id: '69bda9e794efcdaed312b017',
  doctor_id: '69b82d9272e8901244a93546',
  status: 'ACTIVE',
  createdAt: '2026-04-01T16:51:16.056Z',
  updatedAt: '2026-04-01T16:51:16.056Z',
};

const singleConsultationResponseExample = {
  _id: '69bda9e794efcdaed312b017',
  title: 'Consultation from booking',
  status: 'ACTIVE',
  medication_id: [medicationResponseExample],
  investigation_id: [
    {
      _id: '69cd4f763e2fbcfe64995f11',
      name: 'FBC',
      status: 'PENDING',
    },
  ],
  diagnosis_id: [
    {
      _id: '69cd4f763e2fbcfe64995f12',
      title: 'Acute Viral URTI',
      description: 'Symptomatic treatment advised',
    },
  ],
};

const physicalExamResponseExample = {
  _id: '69cd5a043e2fbcfe64995f20',
  general_physical: 'Patient looks well',
  nervous_system: 'Intact',
  respiratory_system: 'Clear',
  cardiovascular_system: 'Normal heart sounds',
  gastrointestinal_system: 'Soft abdomen',
  genitourinary_system: 'Normal',
  musculoskeletal_system: 'No deformities',
  ENT: 'Normal',
  obstetric_gynaecological: 'N/A',
  others: '',
  status: 'INCOMPLETE',
  user_id: '69b352fd0198015c43f6db1e',
  consultation_id: '69bda9e794efcdaed312b017',
  doctor_id: '69b82d9272e8901244a93546',
  createdAt: '2026-04-02T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
};

const historyTakingResponseExample = {
  _id: '69cd5a043e2fbcfe64995f30',
  present_complaint: 'Fever and cough for 3 days',
  history_of_presenting_complaint: 'Onset was gradual',
  past_medical_surgical_history: 'Nil significant',
  medication_history: 'None',
  allergy_history: ['Penicillin'],
  family_history: 'No hereditary conditions',
  travel_history: 'No recent travel',
  occupation: 'Teacher',
  social_history: 'Non-smoker',
  obstetric_gynaecological_history: 'N/A',
  others: '',
  status: 'INCOMPLETE',
  user_id: '69b352fd0198015c43f6db1e',
  consultation_id: '69bda9e794efcdaed312b017',
  doctor_id: '69b82d9272e8901244a93546',
  createdAt: '2026-04-02T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
};

const investigationFormResponseExample = {
  _id: '69cd5a043e2fbcfe64995f40',
  blood_test: 'FBC, LFT, RFT',
  microbiology: 'Blood culture',
  radiology: 'CXR',
  cardiovascular: 'ECG',
  procedures: '',
  others: '',
  status: 'INCOMPLETE',
  user_id: '69b352fd0198015c43f6db1e',
  consultation_id: '69bda9e794efcdaed312b017',
  doctor_id: '69b82d9272e8901244a93546',
  createdAt: '2026-04-02T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
};

const treatmentPlanResponseExample = {
  _id: '69cd5a043e2fbcfe64995f50',
  treatment_plan_details:
    'Paracetamol 500mg TDS for 5 days. Rest. Increase fluid intake.',
  status: 'INCOMPLETE',
  user_id: '69b352fd0198015c43f6db1e',
  consultation_id: '69bda9e794efcdaed312b017',
  doctor_id: '69b82d9272e8901244a93546',
  createdAt: '2026-04-02T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
};

const diagnosisFormResponseExample = {
  _id: '69cd5a043e2fbcfe64995f60',
  provisional_diagnosis: ['Acute Viral URTI', 'Possible Malaria'],
  final_diagnosis: ['Acute Viral URTI'],
  status: 'INCOMPLETE',
  user_id: '69b352fd0198015c43f6db1e',
  consultation_id: '69bda9e794efcdaed312b017',
  doctor_id: '69b82d9272e8901244a93546',
  createdAt: '2026-04-02T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
};

const consultationListResponseExample = {
  data: [singleConsultationResponseExample],
  pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
};

const patientMedicalHistoryResponseExample = [
  {
    _id: '69bda9e794efcdaed312b017',
    appointment_id: {
      _id: '69b8e1234abcd1234ef56789',
      appointment_number: 'APT-001',
      scheduled_start_at_utc: '2026-04-01T09:00:00.000Z',
      scheduled_end_at_utc: '2026-04-01T09:30:00.000Z',
      status: 'COMPLETED',
      reason_for_visit: 'Routine checkup',
      timezone_snapshot: 'Africa/Lagos',
    },
    type: 'IN_PERSON',
    consoltation_for: 'ADULT',
    title: 'Consultation from booking',
    details: 'Patient presented with fever and cough',
    session_number: '1',
    status: 'COMPLETED',
    doctor_id: {
      _id: '69b82d9272e8901244a93546',
      first_name: 'John',
      last_name: 'Doe',
      full_name: 'Dr. John Doe',
      email: 'john.doe@hospital.com',
      specializations: ['General Practice'],
      profile_picture_url: 'https://example.com/doctor.jpg',
    },
    medication_id: [
      {
        _id: '69cd4d043e2fbcfe64995e77',
        formulary: 'TABLET',
        medication: 'Paracetamol',
        dose: 500,
        unit: 'MILLIGRAM',
        interval: 'DAILY',
        duration: 5,
        duration_unit: 'DAY',
        status: 'ACTIVE',
        createdAt: '2026-04-01T16:51:16.056Z',
        updatedAt: '2026-04-01T16:51:16.056Z',
      },
    ],
    investigation_id: [
      {
        _id: '69cd4f763e2fbcfe64995f11',
        name: 'FBC',
        file: null,
        status: 'PENDING',
        createdAt: '2026-04-01T17:00:00.000Z',
        updatedAt: '2026-04-01T17:00:00.000Z',
      },
    ],
    diagnosis_id: [
      {
        _id: '69cd4f763e2fbcfe64995f12',
        title: 'Acute Viral URTI',
        description: 'Symptomatic treatment advised',
        status: 'COMPLETED',
        createdAt: '2026-04-01T17:10:00.000Z',
        updatedAt: '2026-04-01T17:10:00.000Z',
      },
    ],
    history_taking_id: {
      _id: '69cd5a043e2fbcfe64995f30',
      present_complaint: 'Fever and cough for 3 days',
      history_of_presenting_complaint: 'Onset was gradual',
      past_medical_surgical_history: 'Nil significant',
      medication_history: 'None',
      allergy_history: ['Penicillin'],
      family_history: 'No hereditary conditions',
      travel_history: 'No recent travel',
      occupation: 'Teacher',
      social_history: 'Non-smoker',
      obstetric_gynaecological_history: 'N/A',
      others: '',
      status: 'COMPLETED',
      createdAt: '2026-04-01T17:20:00.000Z',
      updatedAt: '2026-04-01T17:20:00.000Z',
    },
    investigation_result_id: {
      _id: '69cd5a043e2fbcfe64995f40',
      blood_test: 'FBC normal',
      microbiology: '',
      radiology: '',
      cardiovascular: '',
      procedures: '',
      others: '',
      status: 'COMPLETED',
      createdAt: '2026-04-01T17:30:00.000Z',
      updatedAt: '2026-04-01T17:30:00.000Z',
    },
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T17:30:00.000Z',
  },
];

@ApiTags('Doctor Consultations')
@Controller('doctors/consultations')
export class DoctorsController extends CoreController {
  constructor(private readonly consultationsService: ConsultationsService) {
    super();
  }

  @Get()
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all consultations for logged-in doctor (paginated)',
  })
  @ApiResponse({
    status: 200,
    description: 'Consultations fetched successfully',
    schema: { example: consultationListResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDoctorConsultation(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Query() query: CoreSearchFilterDatePaginationDto,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.findDoctorConsultation(
      doctor_id,
      query,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/all')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all consultations for logged-in doctor (no pagination)',
  })
  @ApiResponse({
    status: 200,
    description: 'Consultations fetched successfully',
    schema: { example: [singleConsultationResponseExample] },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAllDoctorConsultation(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data =
      await this.consultationsService.getAllDoctorConsultation(doctor_id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Post('/appointments/:appointment_id/start')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start a consultation from an appointment (doctor only)',
  })
  @ApiParam({ name: 'appointment_id', description: 'Appointment id' })
  @ApiBody({ type: CreateConsultationDto })
  @ApiResponse({
    status: 201,
    description: 'Consultation started successfully',
    schema: { example: singleConsultationResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  async startConsultationFromAppointment(
    @Param('appointment_id') appointment_id: string,
    @Body() createConsultation: Partial<CreateConsultationDto>,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data =
      await this.consultationsService.startConsultationFromAppointment(
        doctor_id,
        appointment_id,
        createConsultation,
      );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Patch('/:consultation_id/complete')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a consultation as complete (doctor only)' })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Consultation completed successfully',
    schema: { example: singleConsultationResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async completeConsultation(
    @Param('consultation_id') consultation_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.completeConsultation(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ─── Patient History ───────────────────────────────
  // IMPORTANT: these must stay above @Get('/:consultation_id') to avoid route conflict

  @Get('/patients/:patient_id/history')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Get a patient's full medical history (consultations, medications, investigations, diagnosis, history taking, investigation results)",
  })
  @ApiParam({ name: 'patient_id', description: 'Patient (user) id' })
  @ApiResponse({
    status: 200,
    description: 'Patient medical history fetched successfully',
    schema: { example: patientMedicalHistoryResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPatientMedicalHistory(
    @Param('patient_id') patient_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const data =
      await this.consultationsService.getPatientMedicalHistory(patient_id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/patients/:patient_id/history/consultations')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a patient's consultation history" })
  @ApiParam({ name: 'patient_id', description: 'Patient (user) id' })
  @ApiResponse({
    status: 200,
    description: 'Patient consultation history fetched successfully',
    schema: {
      example: [
        {
          _id: '69bda9e794efcdaed312b017',
          title: 'Consultation from booking',
          type: 'IN_PERSON',
          consoltation_for: 'ADULT',
          status: 'COMPLETED',
          session_number: '1',
          createdAt: '2026-04-01T09:00:00.000Z',
          updatedAt: '2026-04-01T17:30:00.000Z',
          doctor_id: {
            _id: '69b82d9272e8901244a93546',
            first_name: 'John',
            last_name: 'Doe',
            full_name: 'Dr. John Doe',
            specializations: ['General Practice'],
            profile_picture_url: 'https://example.com/doctor.jpg',
          },
          appointment_id: {
            _id: '69b8e1234abcd1234ef56789',
            appointment_number: 'APT-001',
            scheduled_start_at_utc: '2026-04-01T09:00:00.000Z',
            scheduled_end_at_utc: '2026-04-01T09:30:00.000Z',
            status: 'COMPLETED',
            reason_for_visit: 'Routine checkup',
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPatientConsultationHistory(
    @Param('patient_id') patient_id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data =
      await this.consultationsService.getPatientConsultationHistory(patient_id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/patients/:patient_id/history/medications')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a patient's medication history" })
  @ApiParam({ name: 'patient_id', description: 'Patient (user) id' })
  @ApiResponse({
    status: 200,
    description: 'Patient medication history fetched successfully',
    schema: {
      example: [
        {
          _id: '69cd4d043e2fbcfe64995e77',
          formulary: 'TABLET',
          medication: 'Paracetamol',
          dose: 500,
          unit: 'MILLIGRAM',
          interval: 'DAILY',
          duration: 5,
          duration_unit: 'DAY',
          assign_to_patient: false,
          status: 'ACTIVE',
          createdAt: '2026-04-01T16:51:16.056Z',
          updatedAt: '2026-04-01T16:51:16.056Z',
          consultation_id: {
            _id: '69bda9e794efcdaed312b017',
            title: 'Consultation from booking',
            type: 'IN_PERSON',
            status: 'COMPLETED',
            createdAt: '2026-04-01T09:00:00.000Z',
          },
          doctor_id: {
            _id: '69b82d9272e8901244a93546',
            first_name: 'John',
            last_name: 'Doe',
            full_name: 'Dr. John Doe',
            specializations: ['General Practice'],
            profile_picture_url: 'https://example.com/doctor.jpg',
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPatientMedicationHistory(
    @Param('patient_id') patient_id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data =
      await this.consultationsService.getPatientMedicationHistory(patient_id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/patients/:patient_id/history/diagnoses')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a patient's diagnosis history" })
  @ApiParam({ name: 'patient_id', description: 'Patient (user) id' })
  @ApiResponse({
    status: 200,
    description: 'Patient diagnosis history fetched successfully',
    schema: {
      example: [
        {
          _id: '69cd4f763e2fbcfe64995f12',
          title: 'Acute Viral URTI',
          description: 'Symptomatic treatment advised',
          status: 'COMPLETED',
          createdAt: '2026-04-01T17:10:00.000Z',
          updatedAt: '2026-04-01T17:10:00.000Z',
          consultation_id: {
            _id: '69bda9e794efcdaed312b017',
            title: 'Consultation from booking',
            type: 'IN_PERSON',
            status: 'COMPLETED',
            createdAt: '2026-04-01T09:00:00.000Z',
          },
          doctor_id: {
            _id: '69b82d9272e8901244a93546',
            first_name: 'John',
            last_name: 'Doe',
            full_name: 'Dr. John Doe',
            specializations: ['General Practice'],
            profile_picture_url: 'https://example.com/doctor.jpg',
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPatientDiagnosisHistory(
    @Param('patient_id') patient_id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data =
      await this.consultationsService.getPatientDiagnosisHistory(patient_id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/patients/:patient_id/history/investigations')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get a patient's assigned investigation history grouped by consultation",
    description:
      'Returns investigation list items assigned to the patient (assign_to_patient: true), grouped by consultation. Paginated by consultation groups.',
  })
  @ApiParam({ name: 'patient_id', description: 'Patient (user) id' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'perPage', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Patient investigation history fetched successfully',
    schema: {
      example: {
        groups: [
          {
            consultation: {
              _id: '69bda9e794efcdaed312b017',
              title: 'Video Consultation',
              type: 'VIDEO',
              status: 'COMPLETED',
              appointment_id: {
                appointment_number: 'APT-20260522-6309',
                scheduled_start_at_utc: '2026-05-22T22:15:00.000Z',
                scheduled_end_at_utc: '2026-05-22T22:30:00.000Z',
                status: 'CONFIRMED',
                reason_for_visit: 'cough',
              },
            },
            investigation_count: 2,
            investigations: [
              {
                _id: '69cd4f763e2fbcfe64995f12',
                name: 'CBC (Complete Blood Count)',
                category: 'Hematological',
                test_requested: 'CBC (Complete Blood Count)',
                priority: 'Routine',
                specimen: 'Whole Blood (EDTA)',
                assign_to_patient: true,
                result_images: [],
              },
            ],
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          perPage: 20,
          total_pages: 1,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPatientInvestigationHistory(
    @Param('patient_id') patient_id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data =
      await this.consultationsService.getPatientInvestigationListsGroupedByConsultation(
        patient_id,
        page,
        perPage,
      );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/medications/grouped-by-consultation')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get doctor medications grouped by consultation',
    description:
      'Returns all medications created by the authenticated doctor, grouped by consultation_id. ' +
      'Paginated by consultation groups.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'perPage', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Medications grouped by consultation fetched successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDoctorMedicationsGroupedByConsultation(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
  ) {
    const doctor_id = req.doctor._id;
    const data =
      await this.consultationsService.getDoctorMedicationsGroupedByConsultation(
        doctor_id,
        page,
        perPage,
      );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ─── Single Consultation ───────────────────────────

  @Get('/:consultation_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get a single consultation with medication, investigation and diagnosis populated',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Consultation fetched successfully',
    schema: { example: singleConsultationResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async DoctorSingleConsultation(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.singleDoctorConsultation(
      consultation_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // @Post('/:consultation_id/diagnosis')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async createDiagnosis(@Body() diagnosis: DiagnosisDto, @Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.createDiagnosis(diagnosis, doctor_id, consultation_id);
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  // @Get('/investigation/list')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async getDoctorInvestigation(@Res({ passthrough: true }) res: Response, @Req() req, @Query() query: CoreSearchFilterDatePaginationDto) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.findDoctorInvestigation(doctor_id, query);
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  // @Get('/diagnosis/list')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async getDoctorDiagnosis(@Res({ passthrough: true }) res: Response, @Req() req) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.findDoctorDiagnosis(doctor_id);
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  // @Get('/:consultation_id/diagnosis')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async getConsultationDiagnosis(@Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.getConsultationDiagnosis(doctor_id, consultation_id)
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  // @Get('/diagnosis/:diagnosis_id')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async getSingleDiagnosis(@Res({ passthrough: true }) res: Response, @Req() req, @Param('diagnosis_id') diagnosis_id: string) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.findDiagnosis(diagnosis_id, doctor_id)
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);

  // }

  // @Post('/:consultation_id/investigation')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async createInvestigation(@Body() investigation: InvestigationDto, @Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.createInvestigation(investigation, doctor_id, consultation_id);
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  // @Get('/:consultation_id/investigation')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async getConsultationInvestigation(@Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string, @Query() query: CoreSearchFilterDatePaginationDto) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.findDoctorConsultationInvestigation(doctor_id, consultation_id, query);
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  // @Get('investigation/:investigation_id')
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async getSingleInvestigation(@Res({ passthrough: true }) res: Response, @Req() req, @Param('investigation_id') investigation_id: string) {
  //     const doctor_id = req.doctor._id;
  //     const data = await this.consultationsService.findSingleDoctorInvestigation(doctor_id, investigation_id);
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  // @Delete("/investigation/:investigation_id")
  // @ApiExcludeEndpoint()
  // @UseGuards(DoctorGuard)
  // async deleteInvestigation(@Param('investigation_id') investigation_id: string, @Res({ passthrough: true }) res: Response) {
  //     const data = await this.consultationsService.deleteInvestigation(investigation_id);
  //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  // }

  @Post('/:consultation_id/medication')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create medication for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiBody({
    type: CreateMedicationDto,
    schema: { example: medicationRequestExample },
  })
  @ApiResponse({
    status: 200,
    description: 'Medication created successfully',
    schema: { example: medicationResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async createMedication(
    @Body() medication: CreateMedicationDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createMedication(
      medication,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/:consultation_id/medication')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get medication by consultation (doctor only)' })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Medication fetched successfully',
    schema: { example: [medicationResponseExample] },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getMedication(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.findMedication(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/:consultation_id/medications/grouped')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get medications for a consultation grouped by formulary (doctor only)',
    description:
      'Returns all medications prescribed in the given consultation, bucketed by their formulary ' +
      '(TABLET, CAPSULE, SYRUP, INJECTION, ...). Each group includes a `count` and the ordered list ' +
      'of medication records. The authenticated doctor must own the consultation.',
  })
  @ApiParam({
    name: 'consultation_id',
    description: 'Consultation id',
    example: '64f3abc000aaa111',
  })
  @ApiResponse({
    status: 200,
    description: 'Grouped medications fetched successfully',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: {
          consultation_id: '64f3abc000aaa111',
          total: 3,
          groups: [
            {
              formulary: 'TABLET',
              count: 2,
              medications: [
                medicationResponseExample,
                medicationResponseExample,
              ],
            },
            {
              formulary: 'SYRUP',
              count: 1,
              medications: [medicationResponseExample],
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid consultation' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — invalid or missing token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — consultation does not belong to this doctor',
  })
  async getGroupedMedication(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data =
      await this.consultationsService.findGroupedMedicationByConsultation(
        doctor_id,
        consultation_id,
      );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/medication/:medication_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single medication record (doctor only)' })
  @ApiParam({ name: 'medication_id', description: 'Medication id' })
  @ApiResponse({
    status: 200,
    description: 'Medication fetched successfully',
    schema: { example: medicationResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  async getSingleMedication(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('medication_id') medication_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.findSingleMedication(
      doctor_id,
      medication_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('medication/:medication_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update medication record (doctor only)' })
  @ApiParam({ name: 'medication_id', description: 'Medication id' })
  @ApiBody({
    type: UpdateMedicationDto,
    schema: { example: medicationRequestExample },
  })
  @ApiResponse({
    status: 200,
    description: 'Medication updated successfully',
    schema: { example: medicationResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  async updateMedication(
    @Param('medication_id') medication_id: string,
    @Body() medication: UpdateMedicationDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updateMedication(
      medication_id,
      medication,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('medication/:medication_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete medication record (doctor only)' })
  @ApiParam({ name: 'medication_id', description: 'Medication id' })
  @ApiResponse({ status: 200, description: 'Medication deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  async deleteMedication(
    @Param('medication_id') medication_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deleteMedication(
      medication_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @ApiExcludeEndpoint()
  @Get('/:consultation_id/complaint_history')
  @UseGuards(DoctorGuard)
  async getComplaintHistory(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.getComplaintHistory(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Post('/:consultation_id/physical-exam')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create physical exam for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiBody({ type: CreatePhysicalExamDto })
  @ApiResponse({
    status: 201,
    description: 'Physical exam created successfully',
    schema: { example: physicalExamResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  @ApiResponse({
    status: 409,
    description: 'Physical exam already exists for this consultation',
  })
  async createPhysicalExam(
    @Body() physicalExam: CreatePhysicalExamDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createPhysicalExam(
      physicalExam,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('/:consultation_id/physical-exam')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get physical exam for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Physical exam fetched successfully',
    schema: { example: physicalExamResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Physical exam not found' })
  async getPhysicalExam(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.getPhysicalExam(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('physical-exam/:physical_exam_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update physical exam record (doctor only)' })
  @ApiParam({ name: 'physical_exam_id', description: 'Physical exam id' })
  @ApiBody({ type: UpdatePhysicalExamDto })
  @ApiResponse({
    status: 200,
    description: 'Physical exam updated successfully',
    schema: { example: physicalExamResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Physical exam not found' })
  async updatePhysicalExam(
    @Param('physical_exam_id') physical_exam_id: string,
    @Body() physicalExam: UpdatePhysicalExamDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updatePhysicalExam(
      physical_exam_id,
      physicalExam,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('physical-exam/:physical_exam_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete physical exam record (doctor only)' })
  @ApiParam({ name: 'physical_exam_id', description: 'Physical exam id' })
  @ApiResponse({
    status: 200,
    description: 'Physical exam deleted successfully',
    schema: { example: { message: 'Physical exam deleted successfully' } },
  })
  @ApiResponse({ status: 404, description: 'Physical exam not found' })
  async deletePhysicalExam(
    @Param('physical_exam_id') physical_exam_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deletePhysicalExam(
      physical_exam_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('consultation/weekly')
  @UseGuards(DoctorGuard)
  async getWeeklyConsultation(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data =
      await this.consultationsService.getWeeklyConsultation(doctor_id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ─── History Taking ────────────────────────────────

  @Post('/:consultation_id/history-taking')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create history taking for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiBody({ type: CreateHistoryTakingDto })
  @ApiResponse({
    status: 200,
    description: 'History taking created successfully',
    schema: { example: historyTakingResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  @ApiResponse({
    status: 409,
    description: 'History taking already exists for this consultation',
  })
  async createHistoryTaking(
    @Body() dto: CreateHistoryTakingDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createHistoryTaking(
      dto,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('/:consultation_id/history-taking')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get history taking for a consultation (doctor only)',
    description:
      'Returns the saved history taking record when present. If none exists yet, returns a prefilled draft using data captured during appointment booking (e.g. present_complaint).',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description:
      'History taking fetched successfully, or prefilled from booking when not yet created',
    schema: { example: historyTakingResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description:
      'Consultation not found, or no linked appointment to prefill from',
  })
  async getHistoryTaking(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.getHistoryTaking(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('history-taking/:history_taking_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update history taking record (doctor only)' })
  @ApiParam({ name: 'history_taking_id', description: 'History taking id' })
  @ApiBody({ type: UpdateHistoryTakingDto })
  @ApiResponse({
    status: 200,
    description: 'History taking updated successfully',
    schema: { example: historyTakingResponseExample },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'History taking not found' })
  async updateHistoryTaking(
    @Param('history_taking_id') history_taking_id: string,
    @Body() dto: UpdateHistoryTakingDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updateHistoryTaking(
      history_taking_id,
      dto,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('history-taking/:history_taking_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete history taking record (doctor only)' })
  @ApiParam({ name: 'history_taking_id', description: 'History taking id' })
  @ApiResponse({
    status: 200,
    description: 'History taking deleted successfully',
    schema: { example: { message: 'History taking deleted successfully' } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'History taking not found' })
  async deleteHistoryTaking(
    @Param('history_taking_id') history_taking_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deleteHistoryTaking(
      history_taking_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ─── Investigation Form ────────────────────────────

  @Post('/:consultation_id/investigation-result')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create investigation result for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiBody({ type: CreateInvestigationFormDto })
  @ApiResponse({
    status: 201,
    description: 'Investigation result created successfully',
    schema: { example: investigationFormResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  @ApiResponse({
    status: 409,
    description: 'Investigation result already exists for this consultation',
  })
  async createInvestigationForm(
    @Body() dto: CreateInvestigationFormDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createInvestigationForm(
      dto,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('/:consultation_id/investigation-result')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get investigation result for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Investigation result fetched successfully',
    schema: { example: investigationFormResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Investigation result not found' })
  async getInvestigationForm(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.getInvestigationForm(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('investigation-result/:investigation_form_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update investigation result record (doctor only)' })
  @ApiParam({
    name: 'investigation_form_id',
    description: 'Investigation result id',
  })
  @ApiBody({ type: UpdateInvestigationFormDto })
  @ApiResponse({
    status: 200,
    description: 'Investigation result updated successfully',
    schema: { example: investigationFormResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Investigation result not found' })
  async updateInvestigationForm(
    @Param('investigation_form_id') investigation_form_id: string,
    @Body() dto: UpdateInvestigationFormDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updateInvestigationForm(
      investigation_form_id,
      dto,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('investigation-result/:investigation_form_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete investigation result record (doctor only)' })
  @ApiParam({
    name: 'investigation_form_id',
    description: 'Investigation result id',
  })
  @ApiResponse({
    status: 200,
    description: 'Investigation result deleted successfully',
    schema: {
      example: { message: 'Investigation result deleted successfully' },
    },
  })
  @ApiResponse({ status: 404, description: 'Investigation result not found' })
  async deleteInvestigationForm(
    @Param('investigation_form_id') investigation_form_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deleteInvestigationForm(
      investigation_form_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ─── Investigation List ───────────────────────────

  @Post('/:consultation_id/investigation-list')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create investigation list for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiBody({ type: CreateInvestigationListDto })
  @ApiResponse({
    status: 201,
    description: 'Investigation list created successfully',
  })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async createInvestigationList(
    @Body() dto: CreateInvestigationListDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createInvestigationList(
      dto,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('/:consultation_id/investigation-list')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get investigation lists by consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Investigation lists fetched successfully',
  })
  async getInvestigationListsByConsultation(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data =
      await this.consultationsService.getInvestigationListsByConsultation(
        doctor_id,
        consultation_id,
      );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/investigation-list/:investigation_list_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get single investigation list record (doctor only)',
  })
  @ApiParam({
    name: 'investigation_list_id',
    description: 'Investigation list id',
  })
  @ApiResponse({
    status: 200,
    description: 'Investigation list fetched successfully',
  })
  @ApiResponse({ status: 404, description: 'Investigation list not found' })
  async getInvestigationListById(
    @Param('investigation_list_id') investigation_list_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.getInvestigationListById(
      investigation_list_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('/investigation-list/:investigation_list_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update investigation list record (doctor only)' })
  @ApiParam({
    name: 'investigation_list_id',
    description: 'Investigation list id',
  })
  @ApiBody({ type: UpdateInvestigationListDto })
  @ApiResponse({
    status: 200,
    description: 'Investigation list updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Investigation list not found' })
  async updateInvestigationList(
    @Param('investigation_list_id') investigation_list_id: string,
    @Body() dto: UpdateInvestigationListDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updateInvestigationList(
      investigation_list_id,
      dto,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('/investigation-list/:investigation_list_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete investigation list record (doctor only)' })
  @ApiParam({
    name: 'investigation_list_id',
    description: 'Investigation list id',
  })
  @ApiResponse({
    status: 200,
    description: 'Investigation list deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Investigation list not found' })
  async deleteInvestigationList(
    @Param('investigation_list_id') investigation_list_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deleteInvestigationList(
      investigation_list_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ─── Treatment Plan ────────────────────────────────

  @Post('/:consultation_id/treatment-plan')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create treatment plan for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiBody({ type: CreateTreatmentPlanDto })
  @ApiResponse({
    status: 201,
    description: 'Treatment plan created successfully',
    schema: { example: treatmentPlanResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  @ApiResponse({
    status: 409,
    description: 'Treatment plan already exists for this consultation',
  })
  async createTreatmentPlan(
    @Body() dto: CreateTreatmentPlanDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createTreatmentPlan(
      dto,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('/:consultation_id/treatment-plan')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get treatment plan for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Treatment plan fetched successfully',
    schema: { example: treatmentPlanResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Treatment plan not found' })
  async getTreatmentPlan(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.getTreatmentPlan(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('treatment-plan/:treatment_plan_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update treatment plan record (doctor only)' })
  @ApiParam({ name: 'treatment_plan_id', description: 'Treatment plan id' })
  @ApiBody({ type: UpdateTreatmentPlanDto })
  @ApiResponse({
    status: 200,
    description: 'Treatment plan updated successfully',
    schema: { example: treatmentPlanResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Treatment plan not found' })
  async updateTreatmentPlan(
    @Param('treatment_plan_id') treatment_plan_id: string,
    @Body() dto: UpdateTreatmentPlanDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updateTreatmentPlan(
      treatment_plan_id,
      dto,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('treatment-plan/:treatment_plan_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete treatment plan record (doctor only)' })
  @ApiParam({ name: 'treatment_plan_id', description: 'Treatment plan id' })
  @ApiResponse({
    status: 200,
    description: 'Treatment plan deleted successfully',
    schema: { example: { message: 'Treatment plan deleted successfully' } },
  })
  @ApiResponse({ status: 404, description: 'Treatment plan not found' })
  async deleteTreatmentPlan(
    @Param('treatment_plan_id') treatment_plan_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deleteTreatmentPlan(
      treatment_plan_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ─── Diagnosis Form ────────────────────────────────

  @Post('/:consultation_id/diagnosis-form')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create diagnosis form for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiBody({ type: CreateDiagnosisFormDto })
  @ApiResponse({
    status: 201,
    description: 'Diagnosis form created successfully',
    schema: { example: diagnosisFormResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  @ApiResponse({
    status: 409,
    description: 'Diagnosis form already exists for this consultation',
  })
  async createDiagnosisForm(
    @Body() dto: CreateDiagnosisFormDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createDiagnosisForm(
      dto,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('/:consultation_id/diagnosis-form')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get diagnosis form for a consultation (doctor only)',
  })
  @ApiParam({ name: 'consultation_id', description: 'Consultation id' })
  @ApiResponse({
    status: 200,
    description: 'Diagnosis form fetched successfully',
    schema: { example: diagnosisFormResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Diagnosis form not found' })
  async getDiagnosisForm(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
    @Param('consultation_id') consultation_id: string,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.getDiagnosisForm(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('diagnosis-form/:diagnosis_form_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update diagnosis form record (doctor only)' })
  @ApiParam({ name: 'diagnosis_form_id', description: 'Diagnosis form id' })
  @ApiBody({ type: UpdateDiagnosisFormDto })
  @ApiResponse({
    status: 200,
    description: 'Diagnosis form updated successfully',
    schema: { example: diagnosisFormResponseExample },
  })
  @ApiResponse({ status: 404, description: 'Diagnosis form not found' })
  async updateDiagnosisForm(
    @Param('diagnosis_form_id') diagnosis_form_id: string,
    @Body() dto: UpdateDiagnosisFormDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updateDiagnosisForm(
      diagnosis_form_id,
      dto,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('diagnosis-form/:diagnosis_form_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete diagnosis form record (doctor only)' })
  @ApiParam({ name: 'diagnosis_form_id', description: 'Diagnosis form id' })
  @ApiResponse({
    status: 200,
    description: 'Diagnosis form deleted successfully',
    schema: { example: { message: 'Diagnosis form deleted successfully' } },
  })
  @ApiResponse({ status: 404, description: 'Diagnosis form not found' })
  async deleteDiagnosisForm(
    @Param('diagnosis_form_id') diagnosis_form_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deleteDiagnosisForm(
      diagnosis_form_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  // ---------- Referrals (doctor CRUD) ----------

  @Post('/:consultation_id/referral')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a referral for a consultation (doctor only)',
    description:
      'Creates a referral record tied to the given consultation. The authenticated ' +
      'doctor must own the consultation. The referral is also appended to the ' +
      "consultation's `referral_id` array.",
  })
  @ApiParam({
    name: 'consultation_id',
    description: 'Consultation id',
    example: '64f3abc000aaa111',
  })
  @ApiBody({
    type: CreateReferralDto,
    examples: {
      default: {
        summary: 'Referral to cardiology',
        value: referralRequestExample,
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Referral created successfully',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: referralResponseExample,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid consultation or missing fields',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — consultation does not belong to this doctor',
  })
  async createReferral(
    @Body() payload: CreateReferralDto,
    @Param('consultation_id') consultation_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.createReferral(
      payload,
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
  }

  @Get('/:consultation_id/referral')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List referrals for a consultation (doctor only)',
    description:
      'Returns every referral attached to the given consultation, newest first. Doctor must own the consultation.',
  })
  @ApiParam({
    name: 'consultation_id',
    description: 'Consultation id',
    example: '64f3abc000aaa111',
  })
  @ApiResponse({
    status: 200,
    description: 'Referrals fetched successfully',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: [referralResponseExample],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid consultation' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — consultation does not belong to this doctor',
  })
  async getReferralsByConsultation(
    @Param('consultation_id') consultation_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.findReferralsByConsultation(
      doctor_id,
      consultation_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/referrals/grouped')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List referrals grouped by consultation (doctor only)',
    description:
      'Returns all referrals created by the authenticated doctor, grouped by consultation.',
  })
  @ApiResponse({
    status: 200,
    description: 'Grouped referrals fetched successfully',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: [
          {
            consultation: {
              _id: '64f3abc000aaa111',
              title: 'Video Consultation',
              type: 'VIDEO',
              consoltation_for: 'Self',
              status: 'COMPLETED',
              session_number: 1,
              createdAt: '2026-04-21T09:50:00.000Z',
              updatedAt: '2026-04-21T10:20:00.000Z',
            },
            referrals: [
              {
                _id: '64f3ref000bbb222',
                specialist_name: 'Dr. Jane Okafor',
                hospital: 'Lagos University Teaching Hospital',
                referral_details:
                  'Patient presents with persistent chest pain. Please evaluate for cardiac involvement.',
                consultation_id: '64f3abc000aaa111',
                user_id: {
                  _id: '64f3pat000ccc333',
                  first_name: 'Ada',
                  last_name: 'Obi',
                  email: 'ada.obi@example.com',
                  phone_number: '+2348000000000',
                },
                doctor_id: '64f3doc000ddd444',
                createdAt: '2026-04-21T10:00:00.000Z',
                updatedAt: '2026-04-21T10:00:00.000Z',
              },
            ],
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — invalid or missing token',
  })
  async getGroupedDoctorReferrals(
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data =
      await this.consultationsService.findGroupedDoctorReferrals(doctor_id);
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Get('/referral/:referral_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a single referral record (doctor only)',
    description:
      'Fetches one referral. Only accessible to the doctor who created it.',
  })
  @ApiParam({
    name: 'referral_id',
    description: 'Referral id',
    example: '64f3ref000bbb222',
  })
  @ApiResponse({
    status: 200,
    description: 'Referral fetched successfully',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: referralResponseExample,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Referral not found' })
  async getSingleReferral(
    @Param('referral_id') referral_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.findSingleReferral(
      doctor_id,
      referral_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Patch('/referral/:referral_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a referral record (doctor only)',
    description:
      'Partially updates a referral. Any subset of specialist_name, hospital, or referral_details may be provided. Only the creating doctor can update.',
  })
  @ApiParam({
    name: 'referral_id',
    description: 'Referral id',
    example: '64f3ref000bbb222',
  })
  @ApiBody({
    type: UpdateReferralDto,
    examples: {
      default: {
        summary: 'Update referral details',
        value: {
          referral_details: 'Updated notes: ECG and echo results attached.',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Referral updated successfully',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: referralResponseExample,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid referral id' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — referral does not belong to this doctor',
  })
  @ApiResponse({ status: 404, description: 'Referral not found' })
  async updateReferral(
    @Param('referral_id') referral_id: string,
    @Body() payload: UpdateReferralDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.updateReferral(
      referral_id,
      payload,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }

  @Delete('/referral/:referral_id')
  @UseGuards(DoctorGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a referral record (doctor only)',
    description:
      "Deletes the referral and removes its id from the consultation's `referral_id` array. Only the creating doctor can delete.",
  })
  @ApiParam({
    name: 'referral_id',
    description: 'Referral id',
    example: '64f3ref000bbb222',
  })
  @ApiResponse({
    status: 200,
    description: 'Referral deleted successfully',
    schema: {
      example: {
        success: true,
        response_code: '00',
        response_description: 'Success',
        data: { message: 'Referral deleted successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid referral id' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — referral does not belong to this doctor',
  })
  @ApiResponse({ status: 404, description: 'Referral not found' })
  async deleteReferral(
    @Param('referral_id') referral_id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req,
  ) {
    const doctor_id = req.doctor._id;
    const data = await this.consultationsService.deleteReferral(
      referral_id,
      doctor_id,
    );
    return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
  }
}

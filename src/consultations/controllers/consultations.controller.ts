// import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
// import { FileInterceptor } from '@nestjs/platform-express';
// import { diskStorage } from 'multer';
// import { extname } from 'path';
// import { CoreController } from 'src/common/core/controller.core';
// import { ConsultationsService } from '../consultations.service';
// import { CreateConsultationDto } from '../dto/create-consultation.dto';
// import { Response } from 'express';
// import { Consultation } from '../consultations.model';
// import { ApiTags } from '@nestjs/swagger';
// import { AuthGuard } from '@nestjs/passport';
// import { ConsultationFactory } from '../consultation.factory';
// import { PatientGuard } from 'src/auth/guard/patient.guard';
// import { DoctorGuard } from 'src/auth/guard/doctor.guard';
// import { InvestigationDto } from '../dto/create-investigation.dto';
// import { GeneralGuard } from 'src/auth/guard/general.guard';
// import { DiagnosisDto } from '../dto/create-dignosis.dto';
// import { CoreSearchFilterDatePaginationDto } from 'src/common/core/dto.core';


// @ApiTags("Consultations")
// @Controller('consultations')
// // @UseGuards(AuthGuard('jwt'))
// export class ConsultationsController extends CoreController {
//     constructor(
//         private readonly consultationsService: ConsultationsService,
//         private readonly consultationFactory: ConsultationFactory
//     ) {
//         super()
//     }

//     @Get("/:consultation_id")
//     @UseGuards(GeneralGuard)
//     async getSingleConsultation(@Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
//         const patient_id = req.patient._id;
//         // console.log(patient_id)
//         const data = await this.consultationsService.singleConsultion(consultation_id, patient_id);
//         return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     }

//     // @Get("/doctor/:consultation_id")
//     // @UseGuards(DoctorGuard)
//     // async DoctorSingleConsultation(@Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
//     //     const doctor_id = req.doctor._id
//     //     const data = await this.consultationsService.singleDoctorConsultation(consultation_id, doctor_id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Post('/:id')
//     // @UseGuards(PatientGuard)
//     // async createConsultation(@Body() createConsultation: CreateConsultationDto, @Res({ passthrough: true }) res: Response, @Req() req, @Param('id') id: string) {
//     //     const patients_id = req.patient._id
//     //     const data = await this.consultationsService.createNewConsultation(createConsultation, patients_id, id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Post('/diagnosis/:consultation_id')
//     // @UseGuards(DoctorGuard)
//     // async createDiagnosis(@Body() diagnosis: DiagnosisDto, @Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
//     //     const doctor_id = req.doctor._id
//     //     const data = await this.consultationsService.createDiagnosis(diagnosis, doctor_id, consultation_id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Get('/diagnosis/:diagnosis_id')
//     // @UseGuards(GeneralGuard)
//     // async getDiagnosis(@Param('diagnosis_id') diagnosis_id: string, @Res({ passthrough: true }) res: Response) {
//     //     const data = await this.consultationsService.findDiagnosis(diagnosis_id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Get('/investigation/doctor')
//     // @UseGuards(DoctorGuard)
//     // async getDoctorInvestigation(@Res({ passthrough: true }) res: Response, @Req() req) {
//     //     const doctor_id = req.doctor._id
//     //     const data = await this.consultationsService.findDoctorInvestigation(doctor_id)
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Get('/diagnosis/doctor')
//     // @UseGuards(DoctorGuard)
//     // async getDoctorDiagnosis(@Res({ passthrough: true }) res: Response, @Req() req) {
//     //     const doctor_id = req.doctor._id
//     //     // return doctor_id
//     //     const data = await this.consultationsService.findDoctorDiagnosis(doctor_id)
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Get('/investigation/patient')
//     // @UseGuards(PatientGuard)
//     // async getPatientInvestigation(@Res({ passthrough: true }) res: Response, @Req() req) {
//     //     const patients_id = req.patient._id
//     //     const data = await this.consultationsService.findPatientInvestigation(patients_id)
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Get('/diagnosis/patient')
//     // @UseGuards(PatientGuard)
//     // async getPatientDiagnosis(@Res({ passthrough: true }) res: Response, @Req() req) {
//     //     const patients_id = req.patient._id
//     //     // return doctor_id
//     //     const data = await this.consultationsService.findPatientDiagnosis(patients_id)
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Post('/investigation/:consultation_id')
//     // @UseGuards(DoctorGuard)
//     // async createInvestigation(@Body() investigation: InvestigationDto, @Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
//     //     const doctor_id = req.doctor._id
//     //     const data = await this.consultationsService.createInvestigation(investigation, doctor_id, consultation_id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Delete("/investigation/:investigation_id")
//     // @UseGuards(DoctorGuard)
//     // async deleteInvestigation(@Param('investigation_id') investigation_id: string, @Res({ passthrough: true }) res: Response) {
//     //     const data = await this.consultationsService.deleteInvestigation(investigation_id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Post('/investigation/:investigation_id/upload')   
//     // @UseGuards(GeneralGuard)
//     // @UseInterceptors( FileInterceptor('file', {
//     //     storage: diskStorage({
//     //       destination: './uploads/investigations', // Ensure this folder exists
//     //       filename: (req, file, callback) => {
//     //         const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
//     //         callback(null, `${uniqueSuffix}${extname(file.originalname)}`);
//     //       },
//     //     }),
//     //   }),)
//     // async uploadInvestigation(@Res({ passthrough: true }) res: Response,@Param('investigation_id') investigation_id: string,@UploadedFile() file: any) {
//     //     const data = await this.consultationsService.uploadInvestigation(investigation_id,file);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
//     // }


//     // @Patch('investigation/:consultation_id')
//     // @UseGuards(DoctorGuard)
//     // async updateInvestigation(@Body() investigation: InvestigationDto, @Res({ passthrough: true }) res: Response, @Req() req, @Param('consultation_id') consultation_id: string) {
//     //     const doctor_id = req.doctor._id
//     //     const data = await this.consultationsService.updateInvestigation(investigation, doctor_id, consultation_id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
//     // }


//     // @Get('investigation/:consultation_id')
//     // @UseGuards(GeneralGuard)
//     // async getInvestigation(@Param('consultation_id') consultation_id: string, @Res({ passthrough: true }) res: Response) {
//     //     const data = await this.consultationsService.findInvestigation(consultation_id);
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
//     // }

//     // @Get()
//     // @UseGuards(PatientGuard)
//     // async findAll(@Res({ passthrough: true }) res: Response, @Req() req) {
//     //     const patients_id = req.patient._id
//     //     const data = await this.consultationsService.find({ user_id: patients_id });
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

//     // @Get(':id')
//     // async findOne(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
//     //     const data = await this.consultationsService.findOne({ id });
//     //     return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
//     // }

// }

import { Module } from '@nestjs/common';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';
import { MongooseModule } from '@nestjs/mongoose';
import { DoctorSchema } from './doctors.model';
import { DoctorRepository } from './doctors.repository';
import { UsersModule } from 'src/users/users.module';
import { AdminModule } from 'src/admin/admin.module';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import {
  Consultation,
  ConsultationSchema,
  Investigation,
  InvestigationSchema,
  InvestigationList,
  InvestigationListSchema,
  Medication,
  MedicationSchema,
} from 'src/consultations/consultations.model';
import { Appointment, AppointmentSchema } from 'src/bookings/models/appointment.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Doctor', schema: DoctorSchema },
      { name: Consultation.name, schema: ConsultationSchema },
      { name: Medication.name, schema: MedicationSchema },
      { name: Investigation.name, schema: InvestigationSchema },
      { name: InvestigationList.name, schema: InvestigationListSchema },
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
    UsersModule,
    AdminModule,
    CloudinaryModule,
  ],
  controllers: [DoctorsController],
  providers: [DoctorsService, DoctorRepository],
  exports: [DoctorsService, DoctorRepository],
})
export class DoctorsModule { }

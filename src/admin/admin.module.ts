import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

import { MongooseModule } from '@nestjs/mongoose';
import { Admin, AdminSchema } from './admin.model';
import { AdminRepository } from './admin.repository';
import { UsersModule } from 'src/users/users.module';
import { Doctor, DoctorSchema } from 'src/doctors/doctors.model';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { RolesGuard } from 'src/common/guards/roles.guard';
import {
  Consultation,
  ConsultationSchema,
  Investigation,
  InvestigationSchema,
  Medication,
  MedicationSchema,
} from 'src/consultations/consultations.model';
import { Appointment, AppointmentSchema } from 'src/bookings/models/appointment.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: Doctor.name, schema: DoctorSchema },
      { name: Consultation.name, schema: ConsultationSchema },
      { name: Medication.name, schema: MedicationSchema },
      { name: Investigation.name, schema: InvestigationSchema },
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
    UsersModule,
  ],
  providers: [AdminService, AdminRepository, DoctorRepository, RolesGuard],
  controllers: [AdminController],
  exports: [AdminRepository, AdminService]
})
export class AdminModule { }

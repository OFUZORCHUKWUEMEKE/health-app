import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import {
  Appointment,
  AppointmentSchema,
} from 'src/bookings/models/appointment.model';
import {
  Consultation,
  ConsultationSchema,
} from 'src/consultations/consultations.model';
import { DoctorsModule } from 'src/doctors/doctors.module';
import { UsersModule } from 'src/users/users.module';
import { AdminModule } from 'src/admin/admin.module';
import { RolesGuard } from 'src/common/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Consultation.name, schema: ConsultationSchema },
    ]),
    // The three repositories RolesGuard resolves a caller through. AdminModule is here
    // only for that — this module has no admin routes — and it is safe to import because
    // nothing it pulls in reaches back to VideoModule, which app.module.ts alone imports.
    DoctorsModule,
    UsersModule,
    AdminModule,
  ],
  providers: [VideoService, RolesGuard],
  controllers: [VideoController],
  exports: [VideoService],
})
export class VideoModule {}

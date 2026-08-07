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

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Appointment.name, schema: AppointmentSchema },
            { name: Consultation.name, schema: ConsultationSchema },
        ]),
        DoctorsModule,
        UsersModule,
    ],
    providers: [VideoService],
    controllers: [VideoController],
    exports: [VideoService],
})
export class VideoModule {}

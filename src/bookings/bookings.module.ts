import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import {
    DoctorAvailability,
    DoctorAvailabilitySchema,
} from './models/doctor-availability.model';
import { DoctorBlackout, DoctorBlackoutSchema } from './models/doctor-blackout.model';
import { Appointment, AppointmentSchema } from './models/appointment.model';
import { DoctorAvailabilityRepository } from './doctor-availability.repository';
import { DoctorBlackoutRepository } from './doctor-blackout.repository';
import { AppointmentsRepository } from './appointments.repository';
import { Consultation, ConsultationSchema } from 'src/consultations/consultations.model';
import { UsersModule } from 'src/users/users.module';
import { DoctorsModule } from 'src/doctors/doctors.module';
import { AdminModule } from 'src/admin/admin.module';
import { RolesGuard } from 'src/common/guards/roles.guard';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: DoctorAvailability.name, schema: DoctorAvailabilitySchema },
            { name: DoctorBlackout.name, schema: DoctorBlackoutSchema },
            { name: Appointment.name, schema: AppointmentSchema },
            { name: Consultation.name, schema: ConsultationSchema },
        ]),
        UsersModule,
        DoctorsModule,
        AdminModule,
    ],
    controllers: [BookingsController],
    providers: [
        BookingsService,
        DoctorAvailabilityRepository,
        DoctorBlackoutRepository,
        AppointmentsRepository,
        RolesGuard,
    ],
    exports: [BookingsService],
})
export class BookingsModule { }

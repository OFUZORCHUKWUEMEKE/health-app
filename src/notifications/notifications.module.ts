import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from 'src/admin/admin.module';
import { Appointment, AppointmentSchema } from 'src/bookings/models/appointment.model';
import { Consultation, ConsultationSchema } from 'src/consultations/consultations.model';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { DoctorsModule } from 'src/doctors/doctors.module';
import { UsersModule } from 'src/users/users.module';
import { DoctorNotificationsController } from './controllers/doctor-notifications.controller';
import { PatientNotificationsController } from './controllers/patient-notifications.controller';
import { AppointmentNotificationsListener } from './listeners/appointment-notifications.listener';
import { ClinicalNotificationsListener } from './listeners/clinical-notifications.listener';
import { AppointmentReminderService } from './reminders/appointment-reminder.service';
import { RemindersController } from './reminders/reminders.controller';
import { Notification, NotificationSchema } from './models/notification.model';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/**
 * Deliberately acyclic. Listeners need appointment and consultation data, but this module
 * does NOT import BookingsModule / ConsultationsModule / VideoModule — it registers those
 * schemas itself, the same self-contained pattern documented in src/common/mrn/mrn.module.ts
 * and already used by UsersModule, DoctorsModule and AdminModule. `forFeature` is idempotent
 * per connection, so re-registering costs nothing.
 *
 * The emitting side needs no import at all: EventEmitterModule.forRoot() is global by
 * default, so EventEmitter2 injects into BookingsService et al. with zero module wiring.
 *
 * UsersModule / DoctorsModule / AdminModule are imported because RolesGuard injects their
 * repositories. None of the three imports Bookings/Consultations/Video, so no cycle forms.
 *
 * This module MUST be registered in app.module.ts — @nestjs/event-emitter's subscriber
 * loader only discovers listeners in modules that are part of the graph.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Notification.name, schema: NotificationSchema },
            { name: Appointment.name, schema: AppointmentSchema },
            { name: Consultation.name, schema: ConsultationSchema },
        ]),
        UsersModule,
        DoctorsModule,
        AdminModule,
    ],
    controllers: [
        PatientNotificationsController,
        DoctorNotificationsController,
        RemindersController,
    ],
    providers: [
        NotificationsService,
        NotificationsRepository,
        AppointmentNotificationsListener,
        ClinicalNotificationsListener,
        AppointmentReminderService,
        RolesGuard,
    ],
    exports: [NotificationsService],
})
export class NotificationsModule { }

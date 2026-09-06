import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DoctorsModule } from './doctors/doctors.module';
import { UsersModule } from './users/users.module';
import configuration from './config/configuration';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ConsultationsModule } from './consultations/consultations.module';
import { AdminModule } from './admin/admin.module';
import { MailModule } from './mail/mail.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as leanVirtuals from 'mongoose-lean-virtuals';
import { BookingsModule } from './bookings/bookings.module';
import { VideoModule } from './video/video.module';
import { logIndexBuildFailures } from './database/index-error-logger';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';


@Module({
  imports: [
    AuthModule,
    DoctorsModule,
    UsersModule,
    EventEmitterModule.forRoot(),
    // Drives the appointment reminder sweep. In-process is safe on Render's single
    // instance; correctness under multiple instances comes from the atomic claim in
    // AppointmentReminderService, not from there being one scheduler.
    ScheduleModule.forRoot(),
    ConsultationsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const uri = config.get<string>('db_url');
        return {
          uri,
          retryAttempts: 3,
          // The driver's default maxPoolSize is 100. On a 512 MB instance that is a
          // standing native-memory cost (socket buffers plus TLS state per connection)
          // for concurrency this app never reaches — it is one process serving a
          // modest request rate, not a fan-out worker. 10 sockets is ample and keeps
          // the pool from competing with the heap for the container's RAM.
          //
          // Raise DB_MAX_POOL_SIZE if request latency starts showing queueing on the
          // pool rather than in Mongo itself.
          maxPoolSize: Number(process.env.DB_MAX_POOL_SIZE) || 10,
          // Let idle sockets close. Holding a warm floor buys a little latency on the
          // first request after a quiet period and costs memory the whole time.
          minPoolSize: 0,
          maxIdleTimeMS: 60_000,
          connectionFactory: (connection) => {
            connection.plugin(leanVirtuals);
            logIndexBuildFailures(connection);
            return connection;
          },
        };
      },
    }),
    AdminModule,
    MailModule,
    BookingsModule,
    VideoModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

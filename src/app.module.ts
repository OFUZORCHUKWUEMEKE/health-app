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


@Module({
  imports: [
    AuthModule,
    DoctorsModule,
    UsersModule,
    EventEmitterModule.forRoot(),
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
          connectionFactory: (connection) => {
            connection.plugin(leanVirtuals);
            return connection;
          },
        };
      },
    }),
    AdminModule,
    MailModule,
    BookingsModule,
    VideoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/users/users.module';
import { AdminModule } from 'src/admin/admin.module';
import { DoctorsModule } from 'src/doctors/doctors.module';
import { MailModule } from 'src/mail/mail.module';
import { LocalStrategy } from './strategy/local.strategy';
import { GoogleStrategy } from './strategy/google.strategy';
import { RefreshTokenStrategy } from './strategy/refresh-token.strategy';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PendingRegistration,
  PendingRegistrationSchema,
} from './pending-registration.model';
import { PendingRegistrationRepository } from './pending-registration.repository';
import {
  PendingPasswordReset,
  PendingPasswordResetSchema,
} from './pending-password-reset.model';
import { PendingPasswordResetRepository } from './pending-password-reset.repository';

@Module({
  imports: [
    MailModule,
    MongooseModule.forFeature([
      { name: PendingRegistration.name, schema: PendingRegistrationSchema },
      { name: PendingPasswordReset.name, schema: PendingPasswordResetSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({ global: true }),
    PassportModule,
    UsersModule,
    AdminModule,
    DoctorsModule,
  ],
  providers: [
    AuthService,
    TokenService,
    LocalStrategy,
    GoogleStrategy,
    RefreshTokenStrategy,
    RolesGuard,
    PendingRegistrationRepository,
    PendingPasswordResetRepository,
  ],
  controllers: [AuthController],
  exports: [AuthService, TokenService, RolesGuard],
})
export class AuthModule { }

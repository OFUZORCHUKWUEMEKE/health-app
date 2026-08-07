import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.model';
import { UserRepository } from './user.repository';
import { UserFactory } from './user.factory';
import { Doctor, DoctorSchema } from 'src/doctors/doctors.model';
import { Admin, AdminSchema } from 'src/admin/admin.model';
import {
  Consultation,
  ConsultationSchema,
  Investigation,
  InvestigationSchema,
  InvestigationList,
  InvestigationListSchema,
} from 'src/consultations/consultations.model';
import { Appointment, AppointmentSchema } from 'src/bookings/models/appointment.model';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { AdminRepository } from 'src/admin/admin.repository';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

@Module({
  // imports: [MongooseModule.forFeatureAsync([
  //   {
  //     name: 'User',
  //     useFactory: () => {
  //       const schema = UserSchema;
  //       schema.pre<User>('save', async function () {
  //         const user = this;
  //         const salt = await bcrypt.genSalt(10);
  //         const hashPassword = await bcrypt.hash(user.password, salt);
  //         user.password = hashPassword;
  //       });
  //       return schema;
  //     }
  //   }
  // ])],
  imports: [MongooseModule.forFeature([
    { name: 'User', schema: UserSchema },
    { name: 'Doctor', schema: DoctorSchema },
    { name: 'Admin', schema: AdminSchema },
    { name: Consultation.name, schema: ConsultationSchema },
    { name: Investigation.name, schema: InvestigationSchema },
    { name: InvestigationList.name, schema: InvestigationListSchema },
    { name: Appointment.name, schema: AppointmentSchema },
  ]), CloudinaryModule],
  providers: [
    UsersService,
    UserRepository,
    UserFactory,
    DoctorRepository,
    AdminRepository,
    RolesGuard,
  ],
  controllers: [UsersController],
  exports: [UsersService, UserRepository, UserFactory]
})
export class UsersModule { }

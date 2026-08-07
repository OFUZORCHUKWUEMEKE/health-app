import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { AppointmentDocument } from './models/appointment.model';

@Injectable()
export class AppointmentsRepository extends CoreRepository<AppointmentDocument> {
    constructor(
        @InjectModel('Appointment')
        model: Model<AppointmentDocument>,
    ) {
        super(model);
    }
}

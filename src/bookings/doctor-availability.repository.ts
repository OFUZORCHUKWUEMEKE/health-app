import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { DoctorAvailabilityDocument } from './models/doctor-availability.model';

@Injectable()
export class DoctorAvailabilityRepository extends CoreRepository<DoctorAvailabilityDocument> {
    constructor(
        @InjectModel('DoctorAvailability')
        model: Model<DoctorAvailabilityDocument>,
    ) {
        super(model);
    }
}

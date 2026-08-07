import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { DoctorBlackoutDocument } from './models/doctor-blackout.model';

@Injectable()
export class DoctorBlackoutRepository extends CoreRepository<DoctorBlackoutDocument> {
    constructor(
        @InjectModel('DoctorBlackout')
        model: Model<DoctorBlackoutDocument>,
    ) {
        super(model);
    }
}

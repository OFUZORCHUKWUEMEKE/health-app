import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { DoctorDocument } from './doctors.model';


@Injectable()
export class DoctorRepository extends CoreRepository<DoctorDocument> {
    constructor(
        @InjectModel('Doctor')
        doctorModel: Model<DoctorDocument>,
    ) {
        super(doctorModel);
    }
}
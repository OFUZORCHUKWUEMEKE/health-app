import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { TreatmentPlanDocument } from './consultations.model';

@Injectable()
export class TreatmentPlanRepository extends CoreRepository<TreatmentPlanDocument> {
    constructor(
        @InjectModel('TreatmentPlan')
        treatmentPlanModel: Model<TreatmentPlanDocument>,
    ) {
        super(treatmentPlanModel);
    }
}

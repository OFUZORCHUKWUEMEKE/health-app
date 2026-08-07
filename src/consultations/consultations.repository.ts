import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { ConsultationDocument } from './consultations.model';


@Injectable()
export class ConsultationRepository extends CoreRepository<ConsultationDocument> {
    constructor(
        @InjectModel('Consultation')
        consultationModel: Model<ConsultationDocument>,
    ) {
        super(consultationModel);
    }
}
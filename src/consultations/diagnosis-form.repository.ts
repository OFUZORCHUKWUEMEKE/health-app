import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { DiagnosisFormDocument } from './consultations.model';

@Injectable()
export class DiagnosisFormRepository extends CoreRepository<DiagnosisFormDocument> {
    constructor(
        @InjectModel('DiagnosisForm')
        diagnosisFormModel: Model<DiagnosisFormDocument>,
    ) {
        super(diagnosisFormModel);
    }
}

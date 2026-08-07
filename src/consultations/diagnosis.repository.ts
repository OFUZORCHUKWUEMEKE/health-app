import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { ConsultationDocument, DiagnosisDocument, InvestigationDocument } from './consultations.model';


@Injectable()
export class DiagnosisRepository extends CoreRepository<DiagnosisDocument> {
    constructor(
        @InjectModel('Diagnosis')
        diagnosisModel: Model<DiagnosisDocument>
    ) {
        super(diagnosisModel);
    }
}
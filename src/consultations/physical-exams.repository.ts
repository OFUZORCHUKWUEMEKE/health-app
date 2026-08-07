import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { CompliantHistoryDocument, ConsultationDocument, InvestigationDocument, MedicationDocument, PhysicalExam, PhysicalExamDocument } from './consultations.model';


@Injectable()
export class PhysicalExamsRepository extends CoreRepository<PhysicalExamDocument>{
    constructor(
        @InjectModel('PhysicalExam')
        physicalModel: Model<PhysicalExamDocument>,
    ) {
        super(physicalModel);
    }
}
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { CompliantHistoryDocument, ConsultationDocument, InvestigationDocument, MedicationDocument } from './consultations.model';


@Injectable()
export class ComplaintHistoryRepository extends CoreRepository<CompliantHistoryDocument> {
    constructor(
        @InjectModel('CompliantHistory')
        complaintModel: Model<CompliantHistoryDocument>,
    ) {
        super(complaintModel);
    }
}
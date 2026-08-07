import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { ConsultationDocument, InvestigationDocument, MedicationDocument } from './consultations.model';


@Injectable()
export class MedicationRepository extends CoreRepository<MedicationDocument> {
    constructor(
        @InjectModel('Medication')
        medicationModel: Model<MedicationDocument>,
    ) {
        super(medicationModel);
    }
}
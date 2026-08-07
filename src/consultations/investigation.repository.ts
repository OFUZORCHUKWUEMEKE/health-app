import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { ConsultationDocument, InvestigationDocument } from './consultations.model';


@Injectable()
export class InvestigationRepository extends CoreRepository<InvestigationDocument> {
    constructor(
        @InjectModel('Investigation')
        investigationModel: Model<InvestigationDocument>,
    ) {
        super(investigationModel);
    }
}
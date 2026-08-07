import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { InvestigationResultDocument } from './consultations.model';

@Injectable()
export class InvestigationFormRepository extends CoreRepository<InvestigationResultDocument> {
    constructor(
        @InjectModel('InvestigationResult')
        investigationResultModel: Model<InvestigationResultDocument>,
    ) {
        super(investigationResultModel);
    }
}

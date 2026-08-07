import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { InvestigationListDocument } from './consultations.model';

@Injectable()
export class InvestigationListRepository extends CoreRepository<InvestigationListDocument> {
    constructor(
        @InjectModel('InvestigationList')
        investigationListModel: Model<InvestigationListDocument>,
    ) {
        super(investigationListModel);
    }
}

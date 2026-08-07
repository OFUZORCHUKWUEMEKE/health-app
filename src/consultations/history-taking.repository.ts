import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { HistoryTakingDocument } from './consultations.model';

@Injectable()
export class HistoryTakingRepository extends CoreRepository<HistoryTakingDocument> {
    constructor(
        @InjectModel('HistoryTaking')
        historyTakingModel: Model<HistoryTakingDocument>,
    ) {
        super(historyTakingModel);
    }
}

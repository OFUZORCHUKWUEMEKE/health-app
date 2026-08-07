import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { ReferralDocument } from './consultations.model';

@Injectable()
export class ReferralRepository extends CoreRepository<ReferralDocument> {
    constructor(
        @InjectModel('Referral')
        referralModel: Model<ReferralDocument>,
    ) {
        super(referralModel);
    }
}

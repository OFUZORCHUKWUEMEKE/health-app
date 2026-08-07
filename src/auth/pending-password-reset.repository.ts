import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { PendingPasswordResetDocument } from './pending-password-reset.model';

@Injectable()
export class PendingPasswordResetRepository extends CoreRepository<PendingPasswordResetDocument> {
    constructor(
        @InjectModel('PendingPasswordReset')
        model: Model<PendingPasswordResetDocument>,
    ) {
        super(model);
    }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { PendingRegistrationDocument } from './pending-registration.model';

@Injectable()
export class PendingRegistrationRepository extends CoreRepository<PendingRegistrationDocument> {
    constructor(
        @InjectModel('PendingRegistration')
        model: Model<PendingRegistrationDocument>,
    ) {
        super(model);
    }
}

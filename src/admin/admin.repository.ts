import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { AdminDocument } from './admin.model';

@Injectable()
export class AdminRepository extends CoreRepository<AdminDocument> {
    constructor(
        @InjectModel('Admin')
        adminModel: Model<AdminDocument>,
    ) {
        super(adminModel);
    }
}
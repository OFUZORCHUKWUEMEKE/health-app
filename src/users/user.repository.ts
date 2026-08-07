import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { UserDocument } from './user.model';

@Injectable()
export class UserRepository extends CoreRepository<UserDocument> {
    constructor(
        @InjectModel('User')
        userModel: Model<UserDocument>,
    ) {
        super(userModel);
    }
}
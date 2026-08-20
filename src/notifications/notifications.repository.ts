import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CoreRepository } from 'src/common/core/repository.core';
import { NotificationDocument } from './models/notification.model';

@Injectable()
export class NotificationsRepository extends CoreRepository<NotificationDocument> {
    constructor(
        @InjectModel('Notification')
        model: Model<NotificationDocument>,
    ) {
        super(model);
    }
}

import {
    Injectable,
    InternalServerErrorException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class CloudinaryService {
    constructor(private readonly configService: ConfigService) {
        cloudinary.config({
            cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
            api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
            api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
        });
    }

    async uploadProfileImage(file: any, userType: 'patients' | 'doctors', userId: string) {
        const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
        const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
        const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

        if (!cloudName || !apiKey || !apiSecret) {
            throw new ServiceUnavailableException('Cloudinary is not configured');
        }

        if (!file?.buffer || !file?.mimetype) {
            throw new InternalServerErrorException('Invalid file payload');
        }

        const base64DataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

        try {
            const folder =
                this.configService.get<string>('CLOUDINARY_PROFILE_FOLDER') ||
                'health-app/profile-pictures';

            const result: UploadApiResponse = await cloudinary.uploader.upload(base64DataUri, {
                folder,
                resource_type: 'image',
                public_id: `${userType}-${userId}-${Date.now()}`,
                overwrite: true,
                transformation: [
                    { width: 512, height: 512, crop: 'limit' },
                    { quality: 'auto' },
                    { fetch_format: 'auto' },
                ],
            });

            return result.secure_url;
        } catch (error) {
            throw new InternalServerErrorException('Failed to upload image to Cloudinary');
        }
    }

    async uploadInvestigationImage(file: any, patientId: string, investigationListId: string) {
        const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
        const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
        const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

        if (!cloudName || !apiKey || !apiSecret) {
            throw new ServiceUnavailableException('Cloudinary is not configured');
        }

        if (!file?.buffer || !file?.mimetype) {
            throw new InternalServerErrorException('Invalid file payload');
        }

        const base64DataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

        try {
            const folder =
                this.configService.get<string>('CLOUDINARY_INVESTIGATION_FOLDER') ||
                'health-app/investigation-results';

            const result: UploadApiResponse = await cloudinary.uploader.upload(base64DataUri, {
                folder,
                resource_type: 'image',
                public_id: `inv-${investigationListId}-${patientId}-${Date.now()}`,
                transformation: [
                    { width: 2000, height: 2000, crop: 'limit' },
                    { quality: 'auto' },
                    { fetch_format: 'auto' },
                ],
            });

            return result.secure_url;
        } catch (error) {
            throw new InternalServerErrorException('Failed to upload image to Cloudinary');
        }
    }
}

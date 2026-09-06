import {
    Injectable,
    InternalServerErrorException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiOptions, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
    constructor(private readonly configService: ConfigService) {
        cloudinary.config({
            cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
            api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
            api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
        });
    }

    private assertConfigured() {
        const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
        const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
        const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

        if (!cloudName || !apiKey || !apiSecret) {
            throw new ServiceUnavailableException('Cloudinary is not configured');
        }
    }

    /**
     * Push the multer buffer straight at Cloudinary's upload stream.
     *
     * This used to build `data:<mime>;base64,<buffer.toString('base64')>` and hand
     * Cloudinary the string. Base64 is 4/3 the size of the bytes it encodes, so a
     * 10 MB investigation image (the limit the controller allows) cost ~23.5 MB of
     * RSS live at once — the multer buffer, plus the base64 string, plus whatever
     * Cloudinary allocated to turn it back into a request body. Measured, not
     * estimated. On a 512 MB instance two concurrent uploads were a meaningful
     * fraction of the container.
     *
     * Streaming the buffer sends the same bytes with none of the re-encoding, so the
     * cost is the multer buffer and nothing else.
     */
    private uploadBuffer(
        file: { buffer: Buffer; mimetype: string },
        options: UploadApiOptions,
    ): Promise<UploadApiResponse> {
        return new Promise((resolve, reject) => {
            const upload = cloudinary.uploader.upload_stream(options, (error, result) => {
                if (error || !result) {
                    return reject(
                        error ?? new Error('Cloudinary returned no upload result'),
                    );
                }
                resolve(result);
            });

            Readable.from(file.buffer).pipe(upload);
        });
    }

    async uploadProfileImage(file: any, userType: 'patients' | 'doctors', userId: string) {
        this.assertConfigured();

        if (!file?.buffer || !file?.mimetype) {
            throw new InternalServerErrorException('Invalid file payload');
        }

        try {
            const folder =
                this.configService.get<string>('CLOUDINARY_PROFILE_FOLDER') ||
                'health-app/profile-pictures';

            const result = await this.uploadBuffer(file, {
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
        this.assertConfigured();

        if (!file?.buffer || !file?.mimetype) {
            throw new InternalServerErrorException('Invalid file payload');
        }

        try {
            const folder =
                this.configService.get<string>('CLOUDINARY_INVESTIGATION_FOLDER') ||
                'health-app/investigation-results';

            const result = await this.uploadBuffer(file, {
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

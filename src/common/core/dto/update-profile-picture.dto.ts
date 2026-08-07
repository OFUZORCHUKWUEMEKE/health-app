import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateProfilePictureDto {
    @ApiProperty({
        description: 'Public URL of uploaded profile image',
        example: 'https://cdn.mediapp.com/profiles/user-123.jpg',
    })
    @IsString()
    @IsNotEmpty()
    profile_picture_url: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SendTestMailDto {
    @ApiPropertyOptional({
        description: 'Recipient email. Defaults to current authenticated admin email.',
        example: 'admin@example.com',
    })
    @IsOptional()
    @IsEmail()
    to?: string;

    @ApiPropertyOptional({
        description: 'Optional display name in the email body.',
        example: 'Platform Admin',
    })
    @IsOptional()
    @IsString()
    name?: string;
}

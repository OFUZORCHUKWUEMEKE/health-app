import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { IsIanaTimezone } from 'src/common/decorators';

export class UpdateDoctorTimezoneDto {
    @ApiProperty({
        example: 'Africa/Lagos',
        description: 'IANA timezone name (e.g., Africa/Lagos, America/Edmonton)',
    })
    @IsString()
    @IsIanaTimezone()
    @Length(2, 64)
    timezone: string;
}

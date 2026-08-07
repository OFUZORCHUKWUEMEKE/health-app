import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { IsIanaTimezone } from 'src/common/decorators';

export class UpdateTimezoneDto {
    @ApiProperty({
        example: 'Africa/Lagos',
        description: 'IANA timezone name (e.g., Africa/Lagos, America/New_York)',
    })
    @IsString()
    @IsIanaTimezone()
    @Length(2, 64)
    timezone: string;
}

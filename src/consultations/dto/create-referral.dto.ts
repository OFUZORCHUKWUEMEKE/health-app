import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateReferralDto {
    @ApiPropertyOptional({
        description:
            'Full name of the specific doctor the patient is being referred to (optional)',
        example: 'Dr. Adebayo Okonkwo',
    })
    @IsString()
    @IsOptional()
    referred_doctor_name?: string;

    @ApiProperty({ description: 'Name of the specialist the patient is being referred to', example: 'Dr. Jane Okafor' })
    @IsString()
    @IsNotEmpty()
    specialist_name: string;

    @ApiProperty({ description: 'Hospital or clinic the specialist is based at', example: 'Lagos University Teaching Hospital' })
    @IsString()
    @IsNotEmpty()
    hospital: string;

    @ApiProperty({
        description: 'Notes / reason for the referral, relevant findings, etc.',
        example: 'Patient presents with persistent chest pain. Please evaluate for cardiac involvement.',
    })
    @IsString()
    @IsNotEmpty()
    referral_details: string;

    @ApiPropertyOptional({
        description:
            'If true, assigns this referral to the patient (user_id). If false, keeps it as a pending draft.',
        default: false,
    })
    @IsBoolean()
    @IsOptional()
    assign_to_patient?: boolean;
}

export class UpdateReferralDto extends PartialType(CreateReferralDto) {}

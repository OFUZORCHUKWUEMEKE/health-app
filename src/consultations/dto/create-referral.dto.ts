import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  normalizeReferralSpecialty,
  ReferralSpecialtyEnum,
} from '../consultations.enums';

/**
 * Normalizes incoming specialty values onto the current name-based enum.
 * Current names ("Cardiologist") pass through; retired consultant titles
 * ("Consultant Cardiologist", as shipped by the first staging deployment)
 * are mapped to their name equivalent; anything unrecognized or empty
 * becomes undefined so optional-field validation passes cleanly and a
 * drifted specialty list can never block a referral save again (the
 * response_code-006 staging incident).
 */
function normalizeSpecialtyInput({ value }: TransformFnParams): unknown {
    if (typeof value !== 'string') return value;
    return normalizeReferralSpecialty(value) ?? undefined;
}

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

    @ApiPropertyOptional({
        description: "Specialty the referred specialist practices (e.g. Cardiologist, Dentist). Retired 'Consultant …' title values are accepted and normalized.",
        enum: ReferralSpecialtyEnum,
        example: ReferralSpecialtyEnum.CARDIOLOGIST,
    })
    @Transform(normalizeSpecialtyInput)
    @IsEnum(ReferralSpecialtyEnum)
    @IsOptional()
    specialty?: ReferralSpecialtyEnum;

    @IsString()
    @IsNotEmpty()
    hospital: string;

    @ApiPropertyOptional({
        description: 'Postal address lines of the hospital, auto-resolved client-side from the approved catalog',
        type: [String],
        example: ['Idi-Araba', 'Surulere', 'Lagos State', 'Nigeria'],
    })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    hospital_address?: string[];

    @ApiPropertyOptional({
        description: 'Investigation-record ids whose uploaded results are attached to the referral letter',
        type: [String],
        example: ['66c9f0e1a1b2c3d4e5f60718'],
    })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    attachment_investigation_ids?: string[];

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

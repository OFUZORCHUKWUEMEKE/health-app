import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
    IsArray,
    IsDateString,
    IsOptional,
    IsString,
    Length,
} from 'class-validator';

export class UpdatePatientProfileDto {
    private static emptyToUndefined({ value }: TransformFnParams) {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        return trimmed.length ? trimmed : undefined;
    }

    /**
     * Coerce a multipart field into a string[].
     *
     * These endpoints declare multipart/form-data (they accept a profile image), and
     * multipart has no notion of an array: one `allergies=Latex` part arrives as the
     * string 'Latex', while two parts arrive as ['Penicillin', 'Peanuts']. Without this,
     * @IsArray() rejected the single-value case with 400 — so a patient could record two
     * allergies but not one.
     *
     * A JSON array string is also accepted, since that is what several clients send for
     * an array field over multipart.
     *
     * Deliberately does NOT split on commas: an entry like 'Peanuts, tree nuts' is one
     * allergy, and splitting it would silently corrupt clinical data. Callers wanting
     * multiple values send repeated parts or a JSON array.
     */
    private static toStringArray({ value }: TransformFnParams) {
        if (value === undefined || value === null) return undefined;

        if (Array.isArray(value)) {
            return value
                .map((v) => (typeof v === 'string' ? v.trim() : v))
                .filter((v) => v !== '' && v !== undefined && v !== null);
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed.length) return [];

            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        return parsed
                            .map((v) => (typeof v === 'string' ? v.trim() : v))
                            .filter((v) => v !== '');
                    }
                } catch {
                    // Not valid JSON — fall through and treat it as a single value.
                }
            }

            return [trimmed];
        }

        return value;
    }

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    first_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    last_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    middle_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(8, 50)
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    phone_number?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    date_of_birth?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    gender?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    marital_status?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    occupation?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    address?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Transform(UpdatePatientProfileDto.emptyToUndefined)
    profile_picture_url?: string;

    @ApiPropertyOptional({
        type: [String],
        example: ['Penicillin', 'Peanuts'],
        description:
            'Known allergies. Replaces the stored list entirely — send the full list, ' +
            'and send [] to clear it. Over multipart/form-data, repeat the field once ' +
            'per value or send a JSON array string; a single value is accepted too. ' +
            'Values are never split on commas, so "Peanuts, tree nuts" stays one entry.',
    })
    @IsOptional()
    @Transform(UpdatePatientProfileDto.toStringArray)
    @IsArray()
    @IsString({ each: true })
    allergies?: string[];

    @ApiPropertyOptional({
        type: [String],
        example: ['Asthma', 'Hypertension'],
        description:
            'Previous medical conditions. Replaces the stored list entirely — send the ' +
            'full list, and send [] to clear it. Same multipart handling as allergies.',
    })
    @IsOptional()
    @Transform(UpdatePatientProfileDto.toStringArray)
    @IsArray()
    @IsString({ each: true })
    previous_medical_conditions?: string[];

    @ApiPropertyOptional({
        type: [String],
        example: ['diabetic', 'pregnant'],
        description:
            'Clinical flags surfaced to doctors. Replaces the stored list entirely. ' +
            'Same multipart handling as allergies.',
    })
    @IsOptional()
    @Transform(UpdatePatientProfileDto.toStringArray)
    @IsArray()
    @IsString({ each: true })
    medical_flags?: string[];
}

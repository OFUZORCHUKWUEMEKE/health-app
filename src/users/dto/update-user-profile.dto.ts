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

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    allergies?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    previous_medical_conditions?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    medical_flags?: string[];
}

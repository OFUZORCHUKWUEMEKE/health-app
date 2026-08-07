// src/compliant-histories/dto/create-compliant-history.dto.ts
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateCompliantHistoryDto {
    @IsString()
    @IsNotEmpty()
    past_medical_history: string;

    @IsString()
    @IsNotEmpty()
    medication: string;

    @IsString()
    @IsNotEmpty()
    allergy: string;

    @IsString()
    @IsNotEmpty()
    family: string;

    @IsString()
    @IsNotEmpty()
    travel: string;

    @IsString()
    @IsNotEmpty()
    occupation: string;

    @IsString()
    @IsNotEmpty()
    social: string;
}
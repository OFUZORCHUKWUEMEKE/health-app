import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
    MedicationDoseUnit,
    MedicationDurationUnit,
    MedicationFormulation,
    MedicationInterval,
} from '../consultations.enums';

export class MedicationItemDto {
    @ApiProperty({ description: 'Medication formulation', enum: MedicationFormulation })
    @IsEnum(MedicationFormulation)
    @IsNotEmpty()
    formulary: MedicationFormulation;

    @ApiProperty({ description: 'Medication name' })
    @IsString()
    @IsNotEmpty()
    medication: string;

    @ApiProperty({ description: 'Dose amount', example: 500 })
    @Type(() => Number)
    @IsNumber()
    @IsNotEmpty()
    dose: number;

    @ApiProperty({ description: 'Dose unit', enum: MedicationDoseUnit })
    @IsEnum(MedicationDoseUnit)
    @IsNotEmpty()
    unit: MedicationDoseUnit;

    @ApiProperty({ description: 'Medication interval', enum: MedicationInterval })
    @IsEnum(MedicationInterval)
    @IsNotEmpty()
    interval: MedicationInterval;

    @ApiProperty({ description: 'Duration amount', example: 7 })
    @Type(() => Number)
    @IsNumber()
    @IsNotEmpty()
    duration: number;

    @ApiProperty({ description: 'Duration unit', enum: MedicationDurationUnit })
    @IsEnum(MedicationDurationUnit)
    @IsNotEmpty()
    duration_unit: MedicationDurationUnit;

    @ApiPropertyOptional({
        description: 'Prescriber order instructions for the patient',
        example: 'Take with food after meals. Avoid alcohol.',
    })
    @IsString()
    @IsOptional()
    order_instruction?: string;

    @ApiPropertyOptional({
        description: 'Medication start date (YYYY-MM-DD)',
        example: '2026-06-25',
    })
    @IsDateString()
    @IsOptional()
    start_date?: string;

    @ApiPropertyOptional({ description: 'If true, ties this medication to the patient (user_id). If false, no patient link is stored.', default: false })
    @IsBoolean()
    @IsOptional()
    assign_to_patient?: boolean;
}

export class CreateMedicationDto {
    @ApiProperty({
        description: 'Array of medications — one item creates one record, multiple items create multiple records',
        type: [MedicationItemDto],
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MedicationItemDto)
    medications: MedicationItemDto[];
}

export class UpdateMedicationDto extends PartialType(MedicationItemDto) {}

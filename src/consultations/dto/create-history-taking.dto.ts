import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { HistoryTakingStatus } from '../consultations.model';

export class CreateHistoryTakingDto {
    @ApiPropertyOptional({
        description:
            'Present complaint. When omitted, the value from the linked booking appointment is used.',
    })
    @IsString()
    @IsOptional()
    present_complaint?: string;

    @ApiPropertyOptional({ description: 'History of presenting complaint' })
    @IsString()
    @IsOptional()
    history_of_presenting_complaint?: string;

    @ApiPropertyOptional({ description: 'Past medical / surgical history' })
    @IsString()
    @IsOptional()
    past_medical_surgical_history?: string;

    @ApiPropertyOptional({ description: 'Medication history' })
    @IsString()
    @IsOptional()
    medication_history?: string;

    @ApiPropertyOptional({ description: 'Allergy history', type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    allergy_history?: string[];

    @ApiPropertyOptional({ description: 'Family history' })
    @IsString()
    @IsOptional()
    family_history?: string;

    @ApiPropertyOptional({ description: 'Travel history' })
    @IsString()
    @IsOptional()
    travel_history?: string;

    @ApiPropertyOptional({ description: 'Occupation' })
    @IsString()
    @IsOptional()
    occupation?: string;

    @ApiPropertyOptional({ description: 'Social history' })
    @IsString()
    @IsOptional()
    social_history?: string;

    @ApiPropertyOptional({ description: 'Obstetric / gynaecological history' })
    @IsString()
    @IsOptional()
    obstetric_gynaecological_history?: string;

    @ApiPropertyOptional({ description: 'Status', enum: HistoryTakingStatus })
    @IsEnum(HistoryTakingStatus)
    @IsOptional()
    status?: HistoryTakingStatus;

    @ApiPropertyOptional({ description: 'Any additional relevant information' })
    @IsString()
    @IsOptional()
    others?: string;
}

export class UpdateHistoryTakingDto extends PartialType(CreateHistoryTakingDto) { }

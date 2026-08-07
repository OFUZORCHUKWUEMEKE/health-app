import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PhysicalExamStatus } from '../consultations.model';

export class CreatePhysicalExamDto {
    @ApiPropertyOptional({ description: 'General physical examination' })
    @IsString()
    @IsOptional()
    general_physical?: string;

    @ApiPropertyOptional({ description: 'Nervous system examination' })
    @IsString()
    @IsOptional()
    nervous_system?: string;

    @ApiPropertyOptional({ description: 'Respiratory system examination' })
    @IsString()
    @IsOptional()
    respiratory_system?: string;

    @ApiPropertyOptional({ description: 'Cardiovascular system examination' })
    @IsString()
    @IsOptional()
    cardiovascular_system?: string;

    @ApiPropertyOptional({ description: 'Gastro-intestinal system examination' })
    @IsString()
    @IsOptional()
    gastrointestinal_system?: string;

    @ApiPropertyOptional({ description: 'Genito-urinary system examination' })
    @IsString()
    @IsOptional()
    genitourinary_system?: string;

    @ApiPropertyOptional({ description: 'Musculo-skeletal system examination' })
    @IsString()
    @IsOptional()
    musculoskeletal_system?: string;

    @ApiPropertyOptional({ description: 'ENT examination' })
    @IsString()
    @IsOptional()
    ENT?: string;

    @ApiPropertyOptional({ description: 'Obstetric / gynaecological examination' })
    @IsString()
    @IsOptional()
    obstetric_gynaecological?: string;

    @ApiPropertyOptional({ description: 'Any additional relevant information' })
    @IsString()
    @IsOptional()
    others?: string;

    @ApiPropertyOptional({ description: 'Status', enum: PhysicalExamStatus })
    @IsEnum(PhysicalExamStatus)
    @IsOptional()
    status?: PhysicalExamStatus;
}

export class UpdatePhysicalExamDto extends PartialType(CreatePhysicalExamDto) {}

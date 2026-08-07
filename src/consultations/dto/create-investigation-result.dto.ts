import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { InvestigationResultStatus } from '../consultations.model';

export class CreateInvestigationFormDto {
    @ApiPropertyOptional({ description: 'Blood test details' })
    @IsString()
    @IsOptional()
    blood_test?: string;

    @ApiPropertyOptional({ description: 'Microbiology details' })
    @IsString()
    @IsOptional()
    microbiology?: string;

    @ApiPropertyOptional({ description: 'Radiology details' })
    @IsString()
    @IsOptional()
    radiology?: string;

    @ApiPropertyOptional({ description: 'Cardiovascular details' })
    @IsString()
    @IsOptional()
    cardiovascular?: string;

    @ApiPropertyOptional({ description: 'Procedures details' })
    @IsString()
    @IsOptional()
    procedures?: string;

    @ApiPropertyOptional({ description: 'Any additional relevant information' })
    @IsString()
    @IsOptional()
    others?: string;

    @ApiPropertyOptional({ description: 'Status', enum: InvestigationResultStatus })
    @IsEnum(InvestigationResultStatus)
    @IsOptional()
    status?: InvestigationResultStatus;
}

export class UpdateInvestigationFormDto extends PartialType(CreateInvestigationFormDto) {}

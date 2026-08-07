import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { DiagnosisFormStatus } from '../consultations.model';

export class CreateDiagnosisFormDto {
    @ApiPropertyOptional({ description: 'Provisional diagnosis', type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    provisional_diagnosis?: string[];

    @ApiPropertyOptional({ description: 'Final diagnosis', type: [String] })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    final_diagnosis?: string[];

    @ApiPropertyOptional({ description: 'Status', enum: DiagnosisFormStatus })
    @IsEnum(DiagnosisFormStatus)
    @IsOptional()
    status?: DiagnosisFormStatus;
}

export class UpdateDiagnosisFormDto extends PartialType(CreateDiagnosisFormDto) {}

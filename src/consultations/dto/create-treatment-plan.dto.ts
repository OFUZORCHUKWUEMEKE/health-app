import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { TreatmentPlanStatus } from '../consultations.model';

export class CreateTreatmentPlanDto {
    @ApiPropertyOptional({ description: 'Treatment plan details' })
    @IsString()
    @IsOptional()
    treatment_plan_details?: string;

    @ApiPropertyOptional({ description: 'Status', enum: TreatmentPlanStatus })
    @IsEnum(TreatmentPlanStatus)
    @IsOptional()
    status?: TreatmentPlanStatus;
}

export class UpdateTreatmentPlanDto extends PartialType(CreateTreatmentPlanDto) {}

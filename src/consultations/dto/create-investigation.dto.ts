import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
// import { ConsultationStatusEnum } from '../enums/consultation-status.enum'; // Assuming this enum exists
import { Types } from 'mongoose';
import { ConsultationForEnum, ConsultationStatusEnum, ConsultationTypeEnum } from '../consultations.enums';

export class InvestigationDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true }) // Validates that each element in the array is a string
  name: string[];


}
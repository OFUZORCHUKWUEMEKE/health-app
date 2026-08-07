// src/consultation/dto/create-consultation.dto.ts
import { IsString, IsEnum, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { ConsultationForEnum, ConsultationStatusEnum, ConsultationTypeEnum } from '../consultations.enums';
import { ApiProperty } from '@nestjs/swagger';
// import { ConsultationTypeEnum, ConsultationForEnum, ConsultationStatusEnum } from '../enums/consultation.enum';

// export enum ConsultationTypeEnum {
//     CHAT = 'CHAT',
//     AUDIO = 'AUDIO',
//     VIDEO = 'VIDEO',
//     MEETADOCTOR = 'MEETADOCTOR',
//     HOMESERVICE = 'HOMESERVICE'
// }

// export enum ConsultationForEnum {
//     SELF = 'SELF',
//     OTHERS = 'OTHERS'
// }

// export enum StatusEnum {
//     ACTIVE = 'ACTIVE',
//     INACTIVE = 'INACTIVE'
// }

export class CreateConsultationDto {
    @ApiProperty({
        type: String,
        description: 'Type of Consultations',
    })
    @IsEnum(ConsultationTypeEnum)
    type: ConsultationTypeEnum;

    // @ApiProperty({
    //     type: String,
    //     description: 'Users Id',
    // })
    // @IsString()
    // user_id: string;

    // @ApiProperty({
    //     type: String,
    //     description: 'Doctors Id',
    // })
    // @IsOptional()
    // @IsString()
    // doctor_id: string;

    @ApiProperty({
        type: String,
        description: 'Consultation For',
    })
    @IsEnum(ConsultationForEnum)
    consoltation_for: ConsultationForEnum;

    @ApiProperty({
        type: String,
        description: 'Title of Consultation',
    })
    @IsString()
    title: string;

    @ApiProperty({
        type: String,
        description: 'Details of Consultation',
    })
    @IsString()
    @IsOptional()
    details?: string;

    // @ApiProperty({
    //     type: String,
    //     description: 'Session Duration',
    // })
    // @IsString()
    // @IsOptional()
    // session_duration?: string;

    @ApiProperty({
        type: String,
        description: 'Treatment Plan',
    })
    @IsString()
    @IsOptional()
    treatment_plan?: string;

    // @ApiProperty({
    //     type: String,
    //     description: 'Status',
    // })
    // @IsEnum(ConsultationStatusEnum)
    // @IsOptional()
    // status?: ConsultationStatusEnum;
}

// src/consultation/dto/update-consultation.dto.ts

export class UpdateConsultationDto extends PartialType(CreateConsultationDto) { }
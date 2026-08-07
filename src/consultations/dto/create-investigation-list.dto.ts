import { Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class InvestigationListItemDto {
    @ApiProperty({
        description: 'Investigation category',
        example: 'Hematological',
    })
    @IsString()
    @IsNotEmpty()
    category: string;

    @ApiProperty({
        description: 'Test requested',
        example: 'CBC (Complete Blood Count)',
    })
    @IsString()
    @IsNotEmpty()
    test_requested: string;

    @ApiProperty({
        description: 'Investigation priority',
        example: 'Routine',
    })
    @IsString()
    @IsNotEmpty()
    priority: string;

    @ApiPropertyOptional({
        description: 'Specimen type',
        example: 'Whole Blood (EDTA)',
        default: '-',
    })
    @IsString()
    @IsOptional()
    specimen?: string;
}

export class CreateInvestigationListDto {
    @ApiProperty({
        description:
            'Array of investigation items — one item creates one record, multiple items create multiple records',
        type: [InvestigationListItemDto],
        example: [
            {
                category: 'Hematological',
                test_requested: 'CBC (Complete Blood Count)',
                priority: 'Routine',
                specimen: 'Whole Blood (EDTA)',
            },
            {
                category: 'Biochemistry',
                test_requested: 'Lipid Profile',
                priority: 'Urgent',
                specimen: 'Whole Blood (SST)',
            },
        ],
    })
    @IsArray()
    @ArrayNotEmpty()
    @ValidateNested({ each: true })
    @Type(() => InvestigationListItemDto)
    investigations: InvestigationListItemDto[];

    @ApiPropertyOptional({
        description: 'Assign investigation(s) to the patient on the consultation',
        example: true,
        default: false,
    })
    @IsBoolean()
    @IsOptional()
    assign_to_patient?: boolean;
}

export class UpdateInvestigationListDto extends PartialType(
    InvestigationListItemDto,
) {
    @ApiPropertyOptional({
        description: 'Assign this investigation to patient',
        example: true,
    })
    @IsBoolean()
    @IsOptional()
    assign_to_patient?: boolean;
}
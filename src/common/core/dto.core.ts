import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CoreSearchFilterDatePaginationDto {
    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    q: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    page: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    perPage: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Transform(({ value }: TransformFnParams) => value?.trim())
    startDate: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Transform(({ value }: TransformFnParams) => value?.trim())
    endDate: string;
}

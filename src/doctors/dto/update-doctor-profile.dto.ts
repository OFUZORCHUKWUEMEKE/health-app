import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsArray, IsOptional, IsString, Length } from 'class-validator';

export class UpdateDoctorProfileDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    first_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    last_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(8, 50)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    phone_number?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    profile_picture_url?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    specializations?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    license_no?: string;
}

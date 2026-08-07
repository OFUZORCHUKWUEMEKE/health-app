import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
    IsEmail,
    IsEnum,
    IsLowercase,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
} from 'class-validator';

export class CreateUserDto {
    @ApiProperty({
        type: String,
        description: 'First Name is required',
    })
    @IsString()
    @IsNotEmpty()
    @Length(3, 100)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    first_name: string;

    @ApiProperty({
        type: String,
        description: 'Last Name is required',
    })
    @IsString()
    @IsNotEmpty()
    @Length(3, 100)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    last_name: string;

    @ApiProperty({
        type: String,
        description: 'Middle Name is required',
    })

    @IsOptional()
    middle_name: string;

    @ApiProperty({
        type: String,
        description: 'Email is required',
    })
    @IsEmail()
    @IsNotEmpty()
    @Length(3, 100)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    email: string;

    @IsOptional()
    @IsString()
    @Length(8, 50)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    phone_number: string;

    @ApiProperty({
        type: String,
        description: 'Password is required',
    })
    @IsString()
    @IsNotEmpty()
    @Length(8, 255)
    @Transform(({ value }: TransformFnParams) => (value as string)?.trim())
    password: string;
}


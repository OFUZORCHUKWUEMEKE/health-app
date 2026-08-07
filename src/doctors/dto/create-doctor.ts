// src/doctor/dto/create-doctor.dto.ts
import { IsString, IsEmail, IsOptional } from 'class-validator';

export class CreateDoctorDto {
  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  phone_number?: string;

  @IsString()
  password: string;
}


export class LoginDoctorDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { AdminRole, Role } from 'src/common/enums';
import { CreateAdminDto } from 'src/admin/admin.dto';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsNotEmpty()
  @IsString()
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  confirm_password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  newPassword: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  confirmNewPassword: string;
}

// Backward compatibility alias
export class ResetUserPasswordDto extends ChangePasswordDto { }

export class BootstrapAdminDto extends CreateAdminDto {
  @ApiProperty({
    description: 'Bootstrap key from ADMIN_BOOTSTRAP_KEY env variable',
    example: 'change-me-bootstrap-secret',
  })
  @IsNotEmpty()
  @IsString()
  bootstrap_key: string;

  @ApiProperty({ enum: AdminRole, required: false, default: AdminRole.SUPER_ADMIN })
  @IsEnum(AdminRole)
  role: AdminRole = AdminRole.SUPER_ADMIN;
}

export class InitiatePatientRegistrationDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class VerifyPatientRegistrationOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  otp: string;
}

export class ResendPatientRegistrationOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class CompletePatientRegistrationDto {
  @ApiProperty({
    description: 'Short-lived token returned after OTP verification',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsNotEmpty()
  @IsString()
  registration_token: string;

  @ApiProperty({ example: 'John' })
  @IsNotEmpty()
  @IsString()
  first_name: string;

  @ApiProperty({ example: 'Doe' })
  @IsNotEmpty()
  @IsString()
  last_name: string;

  @ApiProperty({ example: 'O', required: false })
  @IsString()
  middle_name?: string;

  @ApiProperty({ example: '+2348012345678', required: false })
  @IsString()
  phone_number?: string;

  @ApiProperty({ example: 'StrongPass123!' })
  @IsNotEmpty()
  @IsString()
  password: string;
}

export class InitiateForgotPasswordOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class VerifyForgotPasswordOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  otp: string;
}

export class ResetPasswordWithOtpTokenDto {
  @ApiProperty({
    description: 'Short-lived token returned after forgot-password OTP verification',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsNotEmpty()
  @IsString()
  reset_token: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  confirm_password: string;
}

// Re-export Role for backward compatibility
export { Role };

import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import {
    ApiBearerAuth,
    ApiBody,
    ApiExcludeEndpoint,
    ApiOperation,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CoreController } from 'src/common/core/controller.core';
import { CreateUserDto } from 'src/users/user.dto';
import { CreateDoctorDto } from 'src/doctors/dto/create-doctor';
import { CreateAdminDto } from 'src/admin/admin.dto';
import {
    BootstrapAdminDto,
    ChangePasswordDto,
    CompletePatientRegistrationDto,
    ForgotPasswordDto,
    InitiatePatientRegistrationDto,
    InitiateForgotPasswordOtpDto,
    LoginDto,
    RefreshTokenDto,
    ResetPasswordWithOtpTokenDto,
    ResendPatientRegistrationOtpDto,
    ResetPasswordDto,
    VerifyForgotPasswordOtpDto,
    VerifyPatientRegistrationOtpDto,
} from './auth.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles, CurrentUser } from 'src/common/decorators';
import { Role } from 'src/common/enums';
import { ConfigService } from '@nestjs/config';

@ApiTags('Auth')
@Controller('auth')
export class AuthController extends CoreController {
    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) {
        super();
    }

    // ─── Patient Auth ──────────────────────────────────────

    @Post('/patients/register/initiate')
    @ApiOperation({ summary: 'Initiate patient registration (email OTP)' })
    @ApiResponse({ status: 200, description: 'OTP generated and sent (and returned in dev/test mode).' })
    @HttpCode(HttpStatus.OK)
    async initiatePatientRegistration(
        @Body() dto: InitiatePatientRegistrationDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.initiatePatientRegistration(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/patients/register/verify-otp')
    @ApiOperation({ summary: 'Verify patient registration OTP' })
    @ApiResponse({ status: 200, description: 'OTP verified, returns short-lived registration token.' })
    @HttpCode(HttpStatus.OK)
    async verifyPatientRegistrationOtp(
        @Body() dto: VerifyPatientRegistrationOtpDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.verifyPatientRegistrationOtp(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/patients/register/resend-otp')
    @ApiOperation({ summary: 'Resend patient registration OTP' })
    @ApiResponse({ status: 200, description: 'New OTP generated and sent (and returned in dev/test mode).' })
    @HttpCode(HttpStatus.OK)
    async resendPatientRegistrationOtp(
        @Body() dto: ResendPatientRegistrationOtpDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.resendPatientRegistrationOtp(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/patients/register/complete')
    @ApiOperation({ summary: 'Complete patient registration with verified token' })
    @ApiResponse({ status: 201, description: 'Patient account created and auth tokens issued.' })
    @HttpCode(HttpStatus.CREATED)
    async completePatientRegistration(
        @Body() dto: CompletePatientRegistrationDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.completePatientRegistration(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    @Post('/patients/signup')
    @HttpCode(HttpStatus.CREATED)
    async patientSignup(
        @Body() createUser: CreateUserDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.patientSignup(createUser);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    @Post('/patients/login')
    @HttpCode(HttpStatus.OK)
    async patientLogin(
        @Body() loginDto: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.patientLogin(loginDto.email, loginDto.password);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // ─── Doctor Auth ───────────────────────────────────────

    @Post('/doctors/signup')
    @ApiExcludeEndpoint()
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.CREATED)
    async doctorSignup(
        @Body() createDoctor: CreateDoctorDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.doctorSignup(createDoctor);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    @Post('/doctors/login')
    @HttpCode(HttpStatus.OK)
    async doctorLogin(
        @Body() loginDto: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.doctorLogin(loginDto.email, loginDto.password);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // ─── Admin Auth ────────────────────────────────────────

    @Post('/admins/signup')
    @ApiExcludeEndpoint()
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.CREATED)
    async adminSignup(
        @Body() createAdmin: CreateAdminDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.adminSignup(createAdmin);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    @Post('/admins/login')
    @ApiOperation({ summary: 'Admin login' })
    @ApiBody({ type: LoginDto })
    @ApiResponse({ status: 200, description: 'Login successful', schema: { example: { access_token: 'eyJhbGci...', refresh_token: 'eyJhbGci...', admin: { _id: '...', email: 'admin@example.com', role: 'ADMIN' } } } })
    @ApiResponse({ status: 401, description: 'Invalid credentials' })
    @HttpCode(HttpStatus.OK)
    async adminLogin(
        @Body() loginDto: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.adminLogin(loginDto.email, loginDto.password);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/admins/bootstrap')
    @ApiExcludeEndpoint()
    @HttpCode(HttpStatus.CREATED)
    async bootstrapAdmin(
        @Body() dto: BootstrapAdminDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.bootstrapAdmin(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.CREATED);
    }

    // ─── Google OAuth ──────────────────────────────────────

    @Get('google')
    @UseGuards(AuthGuard('google'))
    async loginWithGoogle() {
        // Passport redirects to Google
    }

    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    async googleAuthCallback(@Req() req, @Res() res: Response) {
        const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:5173');
        const redirectUrl = new URL('/auth/google', frontendUrl);

        try {
            const data = await this.authService.googleLogin(req);
            redirectUrl.searchParams.set('token', data.token);
            redirectUrl.searchParams.set('refresh_token', data.refresh_token);
            redirectUrl.searchParams.set('role', data.role);
            return res.redirect(redirectUrl.toString());
        } catch (err) {
            const message =
                err?.response?.message ?? err?.message ?? 'Google sign-in failed';
            redirectUrl.searchParams.set('error', String(message));
            return res.redirect(redirectUrl.toString());
        }
    }

    // ─── Token Management ─────────────────────────────────

    @Post('/refresh')
    @HttpCode(HttpStatus.OK)
    async refreshToken(
        @Body() dto: RefreshTokenDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.refreshAccessToken(
            dto.refreshToken,
            dto.role,
        );
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/logout')
    @UseGuards(RolesGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    async logout(
        @CurrentUser() user: any,
        @Req() req: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.logout(user._id, req.userRole);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/change-password')
    @UseGuards(RolesGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    async changePassword(
        @CurrentUser() user: any,
        @Req() req: any,
        @Body() dto: ChangePasswordDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.changePassword(user._id, req.userRole, dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // ─── Password Reset ───────────────────────────────────
    @Post('/forgot-password/initiate')
    @ApiOperation({ summary: 'Initiate forgot-password (email OTP)' })
    @ApiResponse({ status: 200, description: 'Forgot-password OTP generated and sent (and returned in dev/test mode).' })
    @HttpCode(HttpStatus.OK)
    async initiateForgotPasswordOtp(
        @Body() dto: InitiateForgotPasswordOtpDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.initiateForgotPasswordOtp(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/forgot-password/verify-otp')
    @ApiOperation({ summary: 'Verify forgot-password OTP' })
    @ApiResponse({ status: 200, description: 'OTP verified, returns reset token and frontend redirect URL.' })
    @HttpCode(HttpStatus.OK)
    async verifyForgotPasswordOtp(
        @Body() dto: VerifyForgotPasswordOtpDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.verifyForgotPasswordOtp(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/forgot-password/reset')
    @ApiOperation({ summary: 'Reset password with verified OTP reset token' })
    @ApiResponse({ status: 200, description: 'Password reset successful.' })
    @HttpCode(HttpStatus.OK)
    async resetPasswordWithOtpToken(
        @Body() dto: ResetPasswordWithOtpTokenDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.resetPasswordWithOtpToken(dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/forgot-password')
    @ApiOperation({ summary: '[Deprecated] Legacy forgot-password endpoint' })
    @HttpCode(HttpStatus.OK)
    async forgotPassword(
        @Body() dto: ForgotPasswordDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.forgotPassword(dto.email);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    @Post('/reset-password/:token')
    @ApiOperation({ summary: '[Deprecated] Legacy reset-password by token endpoint' })
    @HttpCode(HttpStatus.OK)
    async resetPassword(
        @Param('token') token: string,
        @Body() dto: ResetPasswordDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const data = await this.authService.resetPassword(token, dto);
        return this.responseSuccess(res, '00', 'Success', data, HttpStatus.OK);
    }

    // ─── Email Confirmation ───────────────────────────────

    @Get('/confirm-email/:token')
    @HttpCode(HttpStatus.OK)

    async confirmEmail(
        @Param('token') token: string,
        @Res() res: Response,
    ) {
        await this.authService.confirmEmail(token);
        const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
        return res.redirect(`${frontendUrl}/auth/login`);
    }
}

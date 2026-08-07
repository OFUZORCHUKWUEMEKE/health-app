import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRepository } from 'src/users/user.repository';
import { AdminRepository } from 'src/admin/admin.repository';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { TokenService } from './token.service';
import { MailService } from 'src/mail/mail.service';
import { CreateUserDto } from 'src/users/user.dto';
import { CreateAdminDto } from 'src/admin/admin.dto';
import { CreateDoctorDto } from 'src/doctors/dto/create-doctor';
import {
    BootstrapAdminDto,
    ChangePasswordDto,
    CompletePatientRegistrationDto,
    InitiateForgotPasswordOtpDto,
    InitiatePatientRegistrationDto,
    ResetPasswordWithOtpTokenDto,
    ResendPatientRegistrationOtpDto,
    ResetPasswordDto,
    VerifyForgotPasswordOtpDto,
    VerifyPatientRegistrationOtpDto,
} from './auth.dto';
import { AdminRole, AuthProvider, Role } from 'src/common/enums';
import { GenerateRandomString, generateMRN } from 'src/utils/code-generator.util';
import { ConfigService } from '@nestjs/config';
import { PendingRegistrationRepository } from './pending-registration.repository';
import { PendingPasswordResetRepository } from './pending-password-reset.repository';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly OTP_EXPIRY_MINUTES = 10;
    private readonly OTP_COOLDOWN_SECONDS = 60;
    private readonly OTP_MAX_ATTEMPTS = 5;
    private readonly OTP_MAX_RESENDS_PER_HOUR = 3;
    private readonly FORGOT_OTP_EXPIRY_MINUTES = 10;
    private readonly FORGOT_OTP_COOLDOWN_SECONDS = 60;
    private readonly FORGOT_OTP_MAX_ATTEMPTS = 5;
    private readonly FORGOT_OTP_MAX_RESENDS_PER_HOUR = 3;

    constructor(
        private readonly tokenService: TokenService,
        private readonly userRepository: UserRepository,
        private readonly doctorRepository: DoctorRepository,
        private readonly adminRepository: AdminRepository,
        private readonly pendingRegistrationRepository: PendingRegistrationRepository,
        private readonly pendingPasswordResetRepository: PendingPasswordResetRepository,
        private readonly mailService: MailService,
        private readonly configService: ConfigService,
    ) { }

    // ─── Patient Registration (Email OTP) ─────────────────

    async initiatePatientRegistration(dto: InitiatePatientRegistrationDto) {
        const email = dto.email.toLowerCase().trim();

        const existingUser = await this.userRepository.findOne({ email });
        if (existingUser) {
            throw new ConflictException('Email is already registered. Please log in instead.');
        }

        const otp = this.generateOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const now = new Date();
        const otpExpiresAt = new Date(now.getTime() + this.OTP_EXPIRY_MINUTES * 60 * 1000);
        const cooldownUntil = new Date(now.getTime() + this.OTP_COOLDOWN_SECONDS * 1000);

        const pending = await this.pendingRegistrationRepository.findOne({ email });
        const resendMeta = this.computeResendMeta(pending, now);

        if (resendMeta.resendCount > this.OTP_MAX_RESENDS_PER_HOUR) {
            throw new BadRequestException('Too many OTP requests. Try again later.');
        }

        if (pending) {
            await this.pendingRegistrationRepository.findOneAndUpdate(
                { _id: pending._id },
                {
                    otp_hash: otpHash,
                    otp_expires_at: otpExpiresAt,
                    attempt_count: 0,
                    resend_count: resendMeta.resendCount,
                    resend_window_started_at: resendMeta.windowStartedAt,
                    cooldown_until: cooldownUntil,
                    verified: false,
                    verified_at: null,
                    registration_token_jti: null,
                },
                {},
            );
        } else {
            await this.pendingRegistrationRepository.create({
                email,
                otp_hash: otpHash,
                otp_expires_at: otpExpiresAt,
                attempt_count: 0,
                resend_count: 1,
                resend_window_started_at: now,
                cooldown_until: cooldownUntil,
                verified: false,
            });
        }

        try {
            await this.mailService.sendRegistrationOtp(email, otp, this.OTP_EXPIRY_MINUTES);
        } catch (error) {
            this.logger.warn(
                `Failed to send registration OTP mail to ${email}. Returning OTP in response for testing mode.`,
            );
        }

        return {
            message: 'If this email can be used, an OTP has been sent.',
            email,
            expires_in_minutes: this.OTP_EXPIRY_MINUTES,
            cooldown_seconds: this.OTP_COOLDOWN_SECONDS,
            ...(this.shouldReturnOtpInResponse() ? { otp } : {}),
        };
    }

    async resendPatientRegistrationOtp(dto: ResendPatientRegistrationOtpDto) {
        const email = dto.email.toLowerCase().trim();

        const existingUser = await this.userRepository.findOne({ email });
        if (existingUser) {
            return {
                message: 'If this email can be used, an OTP has been sent.',
                email,
            };
        }

        const pending = await this.pendingRegistrationRepository.findOne({ email });
        if (!pending) {
            return this.initiatePatientRegistration({ email });
        }

        const now = new Date();
        if (pending.cooldown_until && pending.cooldown_until > now) {
            throw new BadRequestException('Please wait before requesting another OTP.');
        }

        const resendMeta = this.computeResendMeta(pending, now);
        if (resendMeta.resendCount > this.OTP_MAX_RESENDS_PER_HOUR) {
            throw new BadRequestException('Too many OTP requests. Try again later.');
        }

        const otp = this.generateOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const otpExpiresAt = new Date(now.getTime() + this.OTP_EXPIRY_MINUTES * 60 * 1000);
        const cooldownUntil = new Date(now.getTime() + this.OTP_COOLDOWN_SECONDS * 1000);

        await this.pendingRegistrationRepository.findOneAndUpdate(
            { _id: pending._id },
            {
                otp_hash: otpHash,
                otp_expires_at: otpExpiresAt,
                attempt_count: 0,
                resend_count: resendMeta.resendCount,
                resend_window_started_at: resendMeta.windowStartedAt,
                cooldown_until: cooldownUntil,
                verified: false,
                verified_at: null,
                registration_token_jti: null,
            },
            {},
        );

        try {
            await this.mailService.sendRegistrationOtp(email, otp, this.OTP_EXPIRY_MINUTES);
        } catch (error) {
            this.logger.warn(
                `Failed to resend registration OTP mail to ${email}. Returning OTP in response for testing mode.`,
            );
        }

        return {
            message: 'If this email can be used, an OTP has been sent.',
            email,
            expires_in_minutes: this.OTP_EXPIRY_MINUTES,
            cooldown_seconds: this.OTP_COOLDOWN_SECONDS,
            ...(this.shouldReturnOtpInResponse() ? { otp } : {}),
        };
    }

    async verifyPatientRegistrationOtp(dto: VerifyPatientRegistrationOtpDto) {
        const email = dto.email.toLowerCase().trim();
        const pending = await this.pendingRegistrationRepository.findOne({ email });

        if (!pending) {
            throw new UnauthorizedException('Invalid or expired OTP');
        }

        const now = new Date();
        if (pending.otp_expires_at < now) {
            throw new BadRequestException('OTP has expired. Request a new one.');
        }

        if (pending.attempt_count >= this.OTP_MAX_ATTEMPTS) {
            throw new ForbiddenException('Too many invalid OTP attempts. Request a new OTP.');
        }

        const isValidOtp = await bcrypt.compare(dto.otp, pending.otp_hash);
        if (!isValidOtp) {
            await this.pendingRegistrationRepository.findOneAndUpdate(
                { _id: pending._id },
                { attempt_count: pending.attempt_count + 1 },
                {},
            );
            throw new UnauthorizedException('Invalid or expired OTP');
        }

        const { token: registration_token, jti } =
            await this.tokenService.generateRegistrationToken(email);

        await this.pendingRegistrationRepository.findOneAndUpdate(
            { _id: pending._id },
            {
                verified: true,
                verified_at: now,
                attempt_count: 0,
                registration_token_jti: jti,
            },
            {},
        );

        return {
            message: 'OTP verified successfully',
            registration_token,
            expires_in: this.configService.get('REGISTRATION_TOKEN_EXPIRATION', '15m'),
        };
    }

    async completePatientRegistration(dto: CompletePatientRegistrationDto) {
        const payload = await this.tokenService.verifyRegistrationToken(dto.registration_token);
        if (payload?.purpose !== 'patient_registration') {
            throw new UnauthorizedException('Invalid registration token');
        }

        const email = payload.email?.toLowerCase?.();
        if (!email) {
            throw new UnauthorizedException('Invalid registration token');
        }

        const existingUser = await this.userRepository.findOne({ email });
        if (existingUser) {
            throw new ConflictException('User already exists');
        }

        const pending = await this.pendingRegistrationRepository.findOne({ email });
        if (!pending || !pending.verified || pending.registration_token_jti !== payload.jti) {
            throw new UnauthorizedException('Registration verification is required');
        }

        const registrationNo = `PAT-${Date.now().toString(36).toUpperCase()}-${GenerateRandomString(4).toUpperCase()}`;
        const passwordHash = await this.hashPassword(dto.password);

        const newUser = await this.userRepository.create(
            this.buildPatientCreatePayload(dto, email, passwordHash, registrationNo, true),
        );

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(
            newUser,
            Role.PATIENT,
        );

        const refreshTokenHash = await this.tokenService.hashRefreshToken(refreshToken);
        await this.userRepository.findOneAndUpdate(
            { _id: newUser._id },
            { refresh_token_hash: refreshTokenHash },
            {},
        );

        await this.pendingRegistrationRepository.delete({ _id: pending._id });

        try {
            await this.mailService.sendWelcomeEmail(
                newUser.email,
                newUser.full_name,
                'patient',
            );
        } catch (error) {
            this.logger.warn(`Failed to send welcome email to patient ${newUser.email}`);
        }

        return {
            user: newUser.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.PATIENT,
        };
    }

    // ─── Patient Auth ──────────────────────────────────────

    async patientSignup(createUser: CreateUserDto) {
        const { email, password } = createUser;

        const existingUser = await this.userRepository.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            throw new ConflictException('User already exists');
        }

        const passwordHash = await this.hashPassword(password);
        const registrationNo = `PAT-${Date.now().toString(36).toUpperCase()}-${GenerateRandomString(4).toUpperCase()}`;

        const newUser = await this.userRepository.create(
            this.buildPatientCreatePayload(
                createUser,
                email.toLowerCase(),
                passwordHash,
                registrationNo,
            ),
        );

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(newUser, Role.PATIENT);

        // Hash refresh token before storing
        const refreshTokenHash = await this.tokenService.hashRefreshToken(refreshToken);
        await this.userRepository.findOneAndUpdate(
            { _id: newUser._id },
            { refresh_token_hash: refreshTokenHash },
            {},
        );

        try {
            await this.mailService.sendEmailConfirmation(newUser, accessToken);
        } catch (error) {
            this.logger.warn(`Failed to send email confirmation to ${newUser.email}`);
        }

        return {
            user: newUser.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.PATIENT,
        };
    }

    async patientLogin(email: string, password: string) {
        const user = await this.userRepository
            .model()
            .findOne({ email: email.toLowerCase() })
            .select('+password_hash')
            .exec();
        if (!user || !user.password_hash) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(user, Role.PATIENT);

        // Hash and store refresh token
        const refreshTokenHash = await this.tokenService.hashRefreshToken(refreshToken);
        await this.userRepository.findOneAndUpdate(
            { _id: user._id },
            { refresh_token_hash: refreshTokenHash },
            {},
        );

        return {
            user: user.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.PATIENT,
        };
    }

    async validateUser(email: string, password: string): Promise<any> {
        const user = await this.userRepository
            .model()
            .findOne({ email: email.toLowerCase() })
            .select('+password_hash')
            .exec();
        if (user && user.password_hash && (await bcrypt.compare(password, user.password_hash))) {
            return user;
        }
        return null;
    }

    // ─── Doctor Auth ───────────────────────────────────────

    async doctorSignup(createDoctor: CreateDoctorDto) {
        const { email, password } = createDoctor;

        const existingDoctor = await this.doctorRepository.findOne({ email: email.toLowerCase() });
        if (existingDoctor) {
            throw new ConflictException('Doctor already exists');
        }

        const passwordHash = await this.hashPassword(password);
        const doctorNo = `DOC-${Date.now().toString(36).toUpperCase()}-${GenerateRandomString(4).toUpperCase()}`;

        const newDoctor = await this.doctorRepository.create({
            ...createDoctor,
            email: email.toLowerCase(),
            password_hash: passwordHash,
            doctor_no: doctorNo,
            full_name: `${createDoctor.first_name} ${createDoctor.last_name}`,
        });

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(newDoctor, Role.DOCTOR);

        const refreshTokenHash = await this.tokenService.hashRefreshToken(refreshToken);
        await this.doctorRepository.findOneAndUpdate(
            { _id: newDoctor._id },
            { refresh_token_hash: refreshTokenHash },
            {},
        );

        try {
            await this.mailService.sendWelcomeEmail(
                newDoctor.email,
                newDoctor.full_name,
                'doctor',
            );
        } catch (error) {
            this.logger.warn(`Failed to send welcome email to doctor ${newDoctor.email}`);
        }

        return {
            doctor: newDoctor.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.DOCTOR,
        };
    }

    async doctorLogin(email: string, password: string) {
        const doctor = await this.doctorRepository.findOne({ email: email.toLowerCase() });
        if (!doctor || !(await bcrypt.compare(password, doctor.password_hash))) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!doctor.active) {
            throw new UnauthorizedException('Doctor account is deactivated. Contact admin.');
        }

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(doctor, Role.DOCTOR);

        const refreshTokenHash = await this.tokenService.hashRefreshToken(refreshToken);
        await this.doctorRepository.findOneAndUpdate(
            { _id: doctor._id },
            { refresh_token_hash: refreshTokenHash },
            {},
        );

        return {
            doctor: doctor.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.DOCTOR,
        };
    }

    // ─── Admin Auth ────────────────────────────────────────

    async adminSignup(createAdmin: CreateAdminDto) {
        const { email, password } = createAdmin;

        const existingAdmin = await this.adminRepository.findOne({ email: email.toLowerCase() });
        if (existingAdmin) {
            throw new ConflictException('Admin already exists');
        }

        const passwordHash = await this.hashPassword(password);

        const newAdmin = await this.adminRepository.create({
            ...createAdmin,
            email: email.toLowerCase(),
            password_hash: passwordHash,
        });

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(newAdmin, Role.ADMIN);

        try {
            await this.mailService.sendWelcomeEmail(
                newAdmin.email,
                `${newAdmin.first_name || ''} ${newAdmin.last_name || ''}`.trim(),
                'admin',
            );
        } catch (error) {
            this.logger.warn(`Failed to send welcome email to admin ${newAdmin.email}`);
        }

        return {
            admin: newAdmin.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.ADMIN,
        };
    }

    async adminLogin(email: string, password: string) {
        const admin = await this.adminRepository.findOne({ email: email.toLowerCase() });
        if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(admin, Role.ADMIN);

        return {
            admin: admin.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.ADMIN,
        };
    }

    async bootstrapAdmin(dto: BootstrapAdminDto) {
        const bootstrapEnabled =
            this.configService.get<string>('ALLOW_ADMIN_BOOTSTRAP', 'false') ===
            'true';
        if (!bootstrapEnabled) {
            throw new ForbiddenException('Admin bootstrap endpoint is disabled');
        }

        const expectedKey = this.configService.get<string>('ADMIN_BOOTSTRAP_KEY');
        if (!expectedKey) {
            throw new ForbiddenException('ADMIN_BOOTSTRAP_KEY is not configured');
        }

        if (dto.bootstrap_key !== expectedKey) {
            throw new UnauthorizedException('Invalid bootstrap key');
        }

        const email = dto.email.toLowerCase();
        const passwordHash = await this.hashPassword(dto.password);
        const role = dto.role || AdminRole.SUPER_ADMIN;

        const existing = await this.adminRepository.findOne({ email });

        if (existing) {
            await this.adminRepository.findOneAndUpdate(
                { _id: existing._id },
                {
                    first_name: dto.first_name,
                    last_name: dto.last_name,
                    phone_number: dto.phone_number,
                    password_hash: passwordHash,
                    role,
                },
                {},
            );

            const updated = await this.adminRepository.findOne({ _id: existing._id });
            const { accessToken, refreshToken } = await this.tokenService.generateTokens(
                updated,
                Role.ADMIN,
            );

            return {
                admin: updated.toJSON(),
                token: accessToken,
                refresh_token: refreshToken,
                role: Role.ADMIN,
                mode: 'updated',
            };
        }

        const created = await this.adminRepository.create({
            first_name: dto.first_name,
            last_name: dto.last_name,
            email,
            phone_number: dto.phone_number,
            password_hash: passwordHash,
            role,
        });

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(
            created,
            Role.ADMIN,
        );

        return {
            admin: created.toJSON(),
            token: accessToken,
            refresh_token: refreshToken,
            role: Role.ADMIN,
            mode: 'created',
        };
    }

    // ─── Google OAuth ──────────────────────────────────────

    async googleLogin(req: any) {
        if (!req.user) {
            throw new BadRequestException('No user from Google');
        }

        const googleEmail = req.user.email?.toLowerCase?.();

        if (!googleEmail) {
            throw new BadRequestException('Google account email is missing');
        }

        const [doctorWithEmail, adminWithEmail] = await Promise.all([
            this.doctorRepository.findOne({ email: googleEmail }),
            this.adminRepository.findOne({ email: googleEmail }),
        ]);

        if (doctorWithEmail) {
            throw new ForbiddenException(
                'This email is registered as a doctor. Google sign-in is only available for patients — please use email/password login.',
            );
        }

        if (adminWithEmail) {
            throw new ForbiddenException(
                'This email is registered as an admin. Google sign-in is only available for patients — please use email/password login.',
            );
        }

        let user = await this.userRepository.findOne({ email: googleEmail });
        let created = false;

        if (!user) {
            const registrationNo = `PAT-${Date.now().toString(36).toUpperCase()}-${GenerateRandomString(4).toUpperCase()}`;
            user = await this.userRepository.create({
                email: googleEmail,
                first_name: req.user.first_name,
                last_name: req.user.last_name,
                full_name: `${req.user.first_name} ${req.user.last_name}`,
                registration_no: registrationNo,
                mrn: generateMRN(),
                provider: AuthProvider.GOOGLE,
                verified: true,
                profile_picture_url: req.user.profile_picture_url,
            });
            created = true;
        } else {
            const updates: Record<string, any> = {
                provider: AuthProvider.GOOGLE,
                verified: true,
            };

            if (!user.profile_picture_url && req.user.profile_picture_url) {
                updates.profile_picture_url = req.user.profile_picture_url;
            }

            await this.userRepository.findOneAndUpdate(
                { _id: user._id },
                updates,
                {},
            );

            user = await this.userRepository.findOne({ _id: user._id });
        }

        const { accessToken, refreshToken } = await this.tokenService.generateTokens(user, Role.PATIENT);

        const refreshTokenHash = await this.tokenService.hashRefreshToken(refreshToken);
        await this.userRepository.findOneAndUpdate(
            { _id: user._id },
            { refresh_token_hash: refreshTokenHash },
            {},
        );

        if (created) {
            try {
                await this.mailService.sendWelcomeEmail(
                    user.email,
                    user.full_name || user.first_name,
                    'patient',
                );
            } catch (error) {
                this.logger.warn(`Failed to send welcome email to Google user ${user.email}`);
            }
        }

        return {
            token: accessToken,
            refresh_token: refreshToken,
            user: user.toJSON(),
            role: Role.PATIENT,
        };
    }

    // ─── Token Refresh ────────────────────────────────────

    async refreshAccessToken(refreshToken: string, role: Role) {
        try {
            const payload = await this.tokenService.verifyRefreshToken(refreshToken);
            const tokenRole = payload.role as Role;

            // Look up user and verify stored refresh token hash
            let user: any;
            if (tokenRole === Role.PATIENT) {
                user = await this.userRepository.findOne({ _id: payload.sub });
            } else if (tokenRole === Role.DOCTOR) {
                user = await this.doctorRepository.findOne({ _id: payload.sub });
            } else if (tokenRole === Role.ADMIN) {
                user = await this.adminRepository.findOne({ _id: payload.sub });
            }

            if (!user || !user.refresh_token_hash) {
                throw new ForbiddenException('Invalid refresh token');
            }

            // Compare provided refresh token against stored hash
            const isValid = await this.tokenService.compareRefreshToken(
                refreshToken,
                user.refresh_token_hash,
            );
            if (!isValid) {
                throw new ForbiddenException('Invalid refresh token');
            }

            // Generate new token pair (token rotation)
            const { accessToken, refreshToken: newRefreshToken } =
                await this.tokenService.generateTokens(user, tokenRole);

            // Store new hashed refresh token
            const newHash = await this.tokenService.hashRefreshToken(newRefreshToken);
            const repo =
                tokenRole === Role.PATIENT
                    ? this.userRepository
                    : tokenRole === Role.DOCTOR
                        ? this.doctorRepository
                        : this.adminRepository;

            await repo.findOneAndUpdate(
                { _id: user._id },
                { refresh_token_hash: newHash },
                {},
            );

            return {
                accessToken,
                refreshToken: newRefreshToken,
            };
        } catch (error) {
            if (error instanceof ForbiddenException) throw error;
            throw new ForbiddenException('Invalid refresh token');
        }
    }

    // ─── Logout ────────────────────────────────────────────

    async logout(userId: string, role: Role) {
        const repo =
            role === Role.PATIENT
                ? this.userRepository
                : role === Role.DOCTOR
                    ? this.doctorRepository
                    : this.adminRepository;

        await repo.findOneAndUpdate(
            { _id: userId },
            { refresh_token_hash: null },
            {},
        );

        return { message: 'Logged out successfully' };
    }

    async changePassword(userId: string, role: Role, dto: ChangePasswordDto) {
        if (dto.newPassword !== dto.confirmNewPassword) {
            throw new BadRequestException('New passwords do not match');
        }

        const repo =
            role === Role.PATIENT
                ? this.userRepository
                : role === Role.DOCTOR
                    ? this.doctorRepository
                    : this.adminRepository;

        const user: any = await repo.findOne({ _id: userId });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const validCurrentPassword = await bcrypt.compare(
            dto.currentPassword,
            user.password_hash,
        );
        if (!validCurrentPassword) {
            throw new UnauthorizedException('Current password is incorrect');
        }

        if (dto.currentPassword === dto.newPassword) {
            throw new BadRequestException('New password must be different from current password');
        }

        const passwordHash = await this.hashPassword(dto.newPassword);
        await repo.findOneAndUpdate(
            { _id: userId },
            { password_hash: passwordHash },
            {},
        );

        try {
            await this.mailService.sendPasswordChangedNotice(
                user.email,
                user.full_name || user.first_name,
            );
        } catch (error) {
            this.logger.warn(`Failed to send password-changed email to ${user.email}`);
        }

        return { message: 'Password changed successfully' };
    }

    // ─── Password Reset ───────────────────────────────────

    async initiateForgotPasswordOtp(dto: InitiateForgotPasswordOtpDto) {
        const email = dto.email.toLowerCase().trim();
        const user = await this.userRepository.findOne({ email });

        if (!user) {
            return {
                message: 'If your email is registered, an OTP has been sent.',
                email,
            };
        }

        const now = new Date();
        const pending = await this.pendingPasswordResetRepository.findOne({ email });

        if (pending?.cooldown_until && pending.cooldown_until > now) {
            throw new BadRequestException('Please wait before requesting another OTP.');
        }

        const resendMeta = this.computeForgotPasswordResendMeta(pending, now);
        if (resendMeta.resendCount > this.FORGOT_OTP_MAX_RESENDS_PER_HOUR) {
            throw new BadRequestException('Too many OTP requests. Try again later.');
        }

        const otp = this.generateOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const otpExpiresAt = new Date(
            now.getTime() + this.FORGOT_OTP_EXPIRY_MINUTES * 60 * 1000,
        );
        const cooldownUntil = new Date(
            now.getTime() + this.FORGOT_OTP_COOLDOWN_SECONDS * 1000,
        );

        if (pending) {
            await this.pendingPasswordResetRepository.findOneAndUpdate(
                { _id: pending._id },
                {
                    otp_hash: otpHash,
                    otp_expires_at: otpExpiresAt,
                    attempt_count: 0,
                    resend_count: resendMeta.resendCount,
                    resend_window_started_at: resendMeta.windowStartedAt,
                    cooldown_until: cooldownUntil,
                    reset_token_jti: null,
                },
                {},
            );
        } else {
            await this.pendingPasswordResetRepository.create({
                email,
                otp_hash: otpHash,
                otp_expires_at: otpExpiresAt,
                attempt_count: 0,
                resend_count: 1,
                resend_window_started_at: now,
                cooldown_until: cooldownUntil,
            });
        }

        try {
            await this.mailService.sendForgotPasswordOtp(
                email,
                otp,
                this.FORGOT_OTP_EXPIRY_MINUTES,
            );
        } catch (error) {
            this.logger.warn(
                `Failed to send forgot-password OTP mail to ${email}. Returning OTP in response for testing mode.`,
            );
        }

        return {
            message: 'If your email is registered, an OTP has been sent.',
            email,
            expires_in_minutes: this.FORGOT_OTP_EXPIRY_MINUTES,
            cooldown_seconds: this.FORGOT_OTP_COOLDOWN_SECONDS,
            ...(this.shouldReturnOtpInResponse() ? { otp } : {}),
        };
    }

    async verifyForgotPasswordOtp(dto: VerifyForgotPasswordOtpDto) {
        const email = dto.email.toLowerCase().trim();
        const pending = await this.pendingPasswordResetRepository.findOne({ email });
        if (!pending) {
            throw new UnauthorizedException('Invalid or expired OTP');
        }

        const now = new Date();
        if (pending.otp_expires_at < now) {
            throw new BadRequestException('OTP has expired. Request a new one.');
        }

        if (pending.attempt_count >= this.FORGOT_OTP_MAX_ATTEMPTS) {
            throw new ForbiddenException('Too many invalid OTP attempts. Request a new OTP.');
        }

        const isValidOtp = await bcrypt.compare(dto.otp, pending.otp_hash);
        if (!isValidOtp) {
            await this.pendingPasswordResetRepository.findOneAndUpdate(
                { _id: pending._id },
                { attempt_count: pending.attempt_count + 1 },
                {},
            );
            throw new UnauthorizedException('Invalid or expired OTP');
        }

        const { token: reset_token, jti } =
            await this.tokenService.generatePasswordResetToken(email);

        await this.pendingPasswordResetRepository.findOneAndUpdate(
            { _id: pending._id },
            {
                attempt_count: 0,
                reset_token_jti: jti,
            },
            {},
        );

        const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');

        return {
            message: 'OTP verified successfully',
            reset_token,
            reset_redirect_url: `${frontendUrl}/auth/reset-password?token=${reset_token}`,
            expires_in: this.configService.get('PASSWORD_RESET_TOKEN_EXPIRATION', '15m'),
        };
    }

    async resetPasswordWithOtpToken(dto: ResetPasswordWithOtpTokenDto) {
        if (dto.password !== dto.confirm_password) {
            throw new BadRequestException('Passwords do not match');
        }

        const payload = await this.tokenService.verifyPasswordResetToken(dto.reset_token);
        if (payload?.purpose !== 'password_reset') {
            throw new UnauthorizedException('Invalid reset token');
        }

        const email = payload.email?.toLowerCase?.();
        if (!email) {
            throw new UnauthorizedException('Invalid reset token');
        }

        const pending = await this.pendingPasswordResetRepository.findOne({ email });
        if (!pending || pending.reset_token_jti !== payload.jti) {
            throw new UnauthorizedException('Password reset verification is required');
        }

        const user = await this.userRepository.findOne({ email });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const passwordHash = await this.hashPassword(dto.password);
        await this.userRepository.findOneAndUpdate(
            { _id: user._id },
            { password_hash: passwordHash, refresh_token_hash: null },
            {},
        );

        try {
            await this.mailService.sendPasswordChangedNotice(
                user.email,
                user.full_name || user.first_name,
            );
        } catch (error) {
            this.logger.warn(`Failed to send password-changed email to ${user.email}`);
        }

        await this.pendingPasswordResetRepository.delete({ _id: pending._id });

        return { message: 'Password reset successful' };
    }

    async forgotPassword(email: string) {
        return this.initiateForgotPasswordOtp({ email });
    }

    async resetPassword(token: string, dto: ResetPasswordDto) {
        if (dto.password !== dto.confirm_password) {
            throw new BadRequestException('Passwords do not match');
        }

        const payload = await this.tokenService.verifyAccessToken(token);
        const user = await this.userRepository.findOne({ email: payload.email });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const passwordHash = await this.hashPassword(dto.password);
        await this.userRepository.findOneAndUpdate(
            { _id: user._id },
            { password_hash: passwordHash },
            {},
        );

        try {
            await this.mailService.sendPasswordChangedNotice(
                user.email,
                user.full_name || user.first_name,
            );
        } catch (error) {
            this.logger.warn(`Failed to send password-changed email to ${user.email}`);
        }

        return { message: 'Password reset successful' };
    }

    // ─── Email Confirmation ───────────────────────────────

    async confirmEmail(token: string) {
        const payload = await this.tokenService.verifyAccessToken(token);
        const user = await this.userRepository.findOne({ email: payload.email });
        if (!user) {
            throw new NotFoundException('User not found');
        }
        await this.userRepository.findOneAndUpdate(
            { _id: user._id },
            { verified: true },
            {},
        );
        return { message: 'Email confirmed' };
    }

    // ─── Helpers ───────────────────────────────────────────

    private async hashPassword(password: string): Promise<string> {
        const salt = await bcrypt.genSalt(10);
        return bcrypt.hash(password, salt);
    }

    private buildPatientCreatePayload(
        dto: {
            first_name: string;
            last_name: string;
            middle_name?: string;
            phone_number?: string;
        },
        email: string,
        passwordHash: string,
        registrationNo: string,
        verified = false,
    ) {
        return {
            email,
            first_name: dto.first_name,
            last_name: dto.last_name,
            middle_name: dto.middle_name,
            phone_number: dto.phone_number,
            password_hash: passwordHash,
            registration_no: registrationNo,
            mrn: generateMRN(),
            full_name: `${dto.first_name} ${dto.last_name}`,
            provider: AuthProvider.LOCAL,
            verified,
        };
    }

    private generateOtp() {
        return `${Math.floor(100000 + Math.random() * 900000)}`;
    }

    private computeResendMeta(pending: any, now: Date) {
        const oneHourMs = 60 * 60 * 1000;
        const windowStart = pending?.resend_window_started_at
            ? new Date(pending.resend_window_started_at)
            : now;

        if (!pending || now.getTime() - windowStart.getTime() > oneHourMs) {
            return {
                resendCount: 1,
                windowStartedAt: now,
            };
        }

        return {
            resendCount: (pending.resend_count || 0) + 1,
            windowStartedAt: windowStart,
        };
    }

    private computeForgotPasswordResendMeta(pending: any, now: Date) {
        const oneHourMs = 60 * 60 * 1000;
        const windowStart = pending?.resend_window_started_at
            ? new Date(pending.resend_window_started_at)
            : now;

        if (!pending || now.getTime() - windowStart.getTime() > oneHourMs) {
            return {
                resendCount: 1,
                windowStartedAt: now,
            };
        }

        return {
            resendCount: (pending.resend_count || 0) + 1,
            windowStartedAt: windowStart,
        };
    }

    private shouldReturnOtpInResponse() {
        const explicit = this.configService.get<string>('RETURN_OTP_IN_RESPONSE');
        if (explicit === 'true') return true;
        if (explicit === 'false') return false;

        const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
        return nodeEnv !== 'production';
    }
}

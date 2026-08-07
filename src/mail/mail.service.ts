import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) { }

  private getDisplayName(user: any): string {
    return (
      user?.first_name ||
      user?.name ||
      user?.full_name ||
      user?.email ||
      'there'
    );
  }

  async sendPasswordReset(user: any, token: string) {
    const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
    const url = `${frontendUrl}/reset-password/${token}`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Password Reset',
      template: './reset-password',
      context: {
        name: this.getDisplayName(user),
        url,
      },
    });
  }

  async sendForgotPassword(user: any, code: string) {
    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Forgot Password Verification',
      template: './forgot-password',
      context: {
        name: this.getDisplayName(user),
        code,
      },
    });
  }

  async sendForgotPasswordOtp(email: string, otp: string, expiresInMinutes = 10) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Your MediApp password reset OTP',
      html: `
        <h3>Password Reset OTP</h3>
        <p>Use this one-time password (OTP) to continue resetting your password:</p>
        <h2 style="letter-spacing: 6px;">${otp}</h2>
        <p>This OTP expires in ${expiresInMinutes} minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    });

    this.logger.log(`Forgot-password OTP sent to ${email}`);
  }

  async sendEmailConfirmation(user: any, token: string) {
    const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
    const url = `${frontendUrl}/auth/confirm-email/${token}`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Please confirm your email address',
      html: `
        <h3>Email Confirmation</h3>
        <p>Thank you for registering. Please confirm your email by clicking the link below:</p>
        <p>
          <a href="${url}">Confirm Email</a>
        </p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    });

    // await this.mailerService.sendMail({
    //   to: user.email,
    //   subject: 'Email Confirmation',
    //   template: './confirm-email',
    //   context: {
    //     name: user.first_name,
    //     url,
    //   },
    // });
  }

  async sendRegistrationOtp(email: string, otp: string, expiresInMinutes = 10) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Your MediApp registration OTP',
      html: `
        <h3>Verify your email</h3>
        <p>Your one-time password (OTP) is:</p>
        <h2 style="letter-spacing: 6px;">${otp}</h2>
        <p>This OTP expires in ${expiresInMinutes} minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    });

    this.logger.log(`Registration OTP sent to ${email}`);
  }

  async sendWelcomeEmail(email: string, name?: string, role: 'patient' | 'doctor' | 'admin' = 'patient') {
    await this.mailerService.sendMail({
      to: email,
      subject: `Welcome to MediApp (${role})`,
      html: `
        <h3>Welcome to MediApp</h3>
        <p>Hi ${name || 'there'},</p>
        <p>Your ${role} account is ready.</p>
        <p>You can now log in and continue.</p>
      `,
    });
  }

  async sendPasswordChangedNotice(email: string, name?: string) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Your password was changed',
      html: `
        <h3>Password Changed</h3>
        <p>Hi ${name || 'there'},</p>
        <p>Your account password was changed successfully.</p>
        <p>If this was not you, please reset your password immediately.</p>
      `,
    });
  }

  async sendTestEmail(email: string, name?: string) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'MediApp mail service test',
      html: `
        <h3>Mail Service Test</h3>
        <p>Hi ${name || 'there'},</p>
        <p>Your mail service is working correctly.</p>
        <p>Sent at: ${new Date().toISOString()}</p>
      `,
    });

    this.logger.log(`Test email sent to ${email}`);
  }

  //   await this.mailerService.sendMail({
  //     to: user.email,
  //     subject: 'Please confirm your email address',
  //     html: `
  //       <h3>Email Confirmation</h3>
  //       <p>Thank you for registering. Please confirm your email by clicking the link below:</p>
  //       <p>
  //         <a href="${url}">Confirm Email</a>
  //       </p>
  //       <p>If you didn't request this, please ignore this email.</p>
  //     `,
  //   });
  // }

}

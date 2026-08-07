import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Role } from 'src/common/enums';

/**
 * Shared TokenService — encapsulates all JWT token generation and refresh token hashing.
 *
 * Replaces the duplicated generateToken() methods in AuthService and DoctorsService.
 */
@Injectable()
export class TokenService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * Generate an access + refresh token pair for a user.
     */
    async generateTokens(user: { _id: any; email: string }, role: Role) {
        const payload = {
            sub: user._id,
            email: user.email,
            role,
        };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: this.configService.get('JWT_SECRET'),
                expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION', '7d'),
            }),
            this.jwtService.signAsync(payload, {
                secret: this.configService.get('JWT_REFRESH_SECRET'),
                expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION', '90d'),
            }),
        ]);

        return { accessToken, refreshToken };
    }

    /**
     * Verify an access token and return the payload.
     */
    async verifyAccessToken(token: string): Promise<any> {
        return this.jwtService.verifyAsync(token, {
            secret: this.configService.get<string>('JWT_SECRET'),
        });
    }

    /**
     * Verify a refresh token and return the payload.
     */
    async verifyRefreshToken(token: string): Promise<any> {
        return this.jwtService.verifyAsync(token, {
            secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        });
    }

    /**
     * Hash a refresh token before storing in the database.
     */
    async hashRefreshToken(refreshToken: string): Promise<string> {
        const salt = await bcrypt.genSalt(10);
        return bcrypt.hash(refreshToken, salt);
    }

    /**
     * Compare a refresh token against its stored hash.
     */
    async compareRefreshToken(
        refreshToken: string,
        hash: string,
    ): Promise<boolean> {
        return bcrypt.compare(refreshToken, hash);
    }

    async generateRegistrationToken(email: string, jti?: string) {
        const tokenJti = jti || randomUUID();
        const token = await this.jwtService.signAsync(
            {
                email,
                purpose: 'patient_registration',
                jti: tokenJti,
            },
            {
                secret:
                    this.configService.get('REGISTRATION_TOKEN_SECRET') ||
                    this.configService.get('JWT_SECRET'),
                expiresIn: this.configService.get('REGISTRATION_TOKEN_EXPIRATION', '15m'),
            },
        );

        return {
            token,
            jti: tokenJti,
        };
    }

    async verifyRegistrationToken(token: string): Promise<any> {
        return this.jwtService.verifyAsync(token, {
            secret:
                this.configService.get('REGISTRATION_TOKEN_SECRET') ||
                this.configService.get('JWT_SECRET'),
        });
    }

    async generatePasswordResetToken(email: string, jti?: string) {
        const tokenJti = jti || randomUUID();
        const token = await this.jwtService.signAsync(
            {
                email,
                purpose: 'password_reset',
                jti: tokenJti,
            },
            {
                secret:
                    this.configService.get('PASSWORD_RESET_TOKEN_SECRET') ||
                    this.configService.get('JWT_SECRET'),
                expiresIn: this.configService.get('PASSWORD_RESET_TOKEN_EXPIRATION', '15m'),
            },
        );

        return {
            token,
            jti: tokenJti,
        };
    }

    async verifyPasswordResetToken(token: string): Promise<any> {
        return this.jwtService.verifyAsync(token, {
            secret:
                this.configService.get('PASSWORD_RESET_TOKEN_SECRET') ||
                this.configService.get('JWT_SECRET'),
        });
    }
}

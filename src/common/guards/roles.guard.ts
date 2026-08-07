import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums';
import { UserRepository } from 'src/users/user.repository';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { AdminRepository } from 'src/admin/admin.repository';

/**
 * Unified authentication + authorization guard.
 *
 * Replaces the old PatientGuard, DoctorGuard, AdminGuard, and GeneralGuard.
 *
 * HOW IT WORKS:
 * 1. Extracts and verifies the JWT from the Authorization header.
 * 2. Reads the `role` claim from the token payload.
 * 3. Looks up the user in the correct repository based on `role`.
 * 4. Checks against any roles specified by the @Roles() decorator on the endpoint.
 * 5. Attaches the user entity to `req.user` uniformly (not req.patient / req.doctor / req.admin).
 *
 * USAGE:
 *   @UseGuards(RolesGuard)
 *   @Roles(Role.DOCTOR)         // only doctors
 *   @Get('/consultations')
 *   getConsultations(@CurrentUser() doctor: Doctor) {}
 *
 *   @UseGuards(RolesGuard)
 *   @Roles(Role.PATIENT, Role.DOCTOR)  // either patients or doctors
 *   @Get('/profile')
 *   getProfile(@CurrentUser() user: any) {}
 *
 *   @UseGuards(RolesGuard)
 *   // No @Roles() decorator = any authenticated user
 *   @Get('/shared-data')
 *   getSharedData(@CurrentUser() user: any) {}
 */
@Injectable()
export class RolesGuard implements CanActivate {
    private readonly logger = new Logger(RolesGuard.name);

    constructor(
        private readonly reflector: Reflector,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly userRepository: UserRepository,
        private readonly doctorRepository: DoctorRepository,
        private readonly adminRepository: AdminRepository,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = this.extractTokenFromHeader(request);

        if (!token) {
            throw new UnauthorizedException('Missing authorization token');
        }

        // 1. Verify JWT
        let payload: any;
        try {
            payload = await this.jwtService.verifyAsync(token, {
                secret: this.configService.get<string>('JWT_SECRET'),
            });
        } catch {
            throw new UnauthorizedException('Invalid or expired token');
        }

        const tokenRole = payload.role as Role;
        if (!tokenRole) {
            throw new UnauthorizedException('Token is missing role claim');
        }

        // 2. Look up user in the correct repository based on the token role
        const user = await this.resolveUser(payload.email, tokenRole);
        if (!user) {
            throw new UnauthorizedException('User not found or account deactivated');
        }

        // 3. Check against route-level @Roles() requirements
        const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        // If @Roles() was specified, the token role must be in the list
        if (requiredRoles && requiredRoles.length > 0) {
            if (!requiredRoles.includes(tokenRole)) {
                throw new UnauthorizedException(
                    `Access denied. Required roles: ${requiredRoles.join(', ')}`,
                );
            }
        }

        // 4. Attach user to request uniformly as `req.user`
        // Also preserve backward-compat keys so existing controllers keep working
        request.user = user;
        request.userRole = tokenRole;

        if (tokenRole === Role.PATIENT) request.patient = user;
        if (tokenRole === Role.DOCTOR) request.doctor = user;
        if (tokenRole === Role.ADMIN) request.admin = user;

        return true;
    }

    /**
     * Look up the user entity from the correct collection based on the JWT role.
     */
    private async resolveUser(email: string, role: Role): Promise<any> {
        switch (role) {
            case Role.PATIENT:
                return this.userRepository.findOne({ email });
            case Role.DOCTOR:
                const doctor = await this.doctorRepository.findOne({ email });
                if (doctor && !doctor.active) {
                    throw new UnauthorizedException('Doctor account is deactivated');
                }
                return doctor;
            case Role.ADMIN:
                return this.adminRepository.findOne({ email });
            default:
                return null;
        }
    }

    private extractTokenFromHeader(request: any): string | undefined {
        const [type, token] = request.headers.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : undefined;
    }
}

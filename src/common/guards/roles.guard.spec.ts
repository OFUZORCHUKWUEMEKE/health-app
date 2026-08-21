import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../enums';
import { RolesGuard } from './roles.guard';

/**
 * RolesGuard is the only thing in the codebase that enforces `doctor.active`, so a
 * deactivated clinician losing access rests entirely on the branch tested here. The
 * legacy DoctorGuard it replaces has no such check.
 */
describe('RolesGuard', () => {
    const reflector = { getAllAndOverride: jest.fn() };
    const jwtService = { verifyAsync: jest.fn() };
    const configService = { get: jest.fn(() => 'test-secret') };
    const userRepository = { findOne: jest.fn() };
    const doctorRepository = { findOne: jest.fn() };
    const adminRepository = { findOne: jest.fn() };

    let guard: RolesGuard;

    /** A request carrying a Bearer token, plus the ExecutionContext shape the guard reads. */
    const contextFor = (request: Record<string, any>) =>
        ({
            switchToHttp: () => ({ getRequest: () => request }),
            getHandler: () => jest.fn(),
            getClass: () => jest.fn(),
        }) as any;

    // Typed loosely on purpose: the guard mutates the request, and the assertions read
    // back the keys it attached.
    const authed = (overrides: Record<string, any> = {}): Record<string, any> => ({
        headers: { authorization: 'Bearer a.b.c' },
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        guard = new RolesGuard(
            reflector as any,
            jwtService as any,
            configService as any,
            userRepository as any,
            doctorRepository as any,
            adminRepository as any,
        );

        // No @Roles() by default — "any authenticated user".
        reflector.getAllAndOverride.mockReturnValue(undefined);
    });

    describe('doctor deactivation', () => {
        it('rejects a doctor whose account has been deactivated', async () => {
            jwtService.verifyAsync.mockResolvedValue({
                email: 'doc@example.com',
                role: Role.DOCTOR,
            });
            doctorRepository.findOne.mockResolvedValue({
                _id: new Types.ObjectId(),
                email: 'doc@example.com',
                active: false,
            });

            await expect(guard.canActivate(contextFor(authed()))).rejects.toThrow(
                /deactivated/,
            );
        });

        it('admits a doctor whose account is still active', async () => {
            const request = authed();
            jwtService.verifyAsync.mockResolvedValue({
                email: 'doc@example.com',
                role: Role.DOCTOR,
            });
            doctorRepository.findOne.mockResolvedValue({
                _id: new Types.ObjectId(),
                email: 'doc@example.com',
                active: true,
            });

            await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
        });

        // A deactivated doctor's JWT stays cryptographically valid until it expires, so
        // the check must happen on every request rather than at login.
        it('rejects even when the token itself verifies cleanly', async () => {
            jwtService.verifyAsync.mockResolvedValue({
                email: 'doc@example.com',
                role: Role.DOCTOR,
            });
            doctorRepository.findOne.mockResolvedValue({ active: false });

            await expect(
                guard.canActivate(contextFor(authed())),
            ).rejects.toBeInstanceOf(UnauthorizedException);
            expect(jwtService.verifyAsync).toHaveBeenCalled();
        });
    });

    describe('role enforcement', () => {
        it('rejects a token whose role is not in the required list', async () => {
            reflector.getAllAndOverride.mockReturnValue([Role.DOCTOR]);
            jwtService.verifyAsync.mockResolvedValue({
                email: 'pat@example.com',
                role: Role.PATIENT,
            });
            userRepository.findOne.mockResolvedValue({ _id: new Types.ObjectId() });

            await expect(guard.canActivate(contextFor(authed()))).rejects.toThrow(
                /Access denied/,
            );
        });

        it('admits any authenticated role when no @Roles() is declared', async () => {
            jwtService.verifyAsync.mockResolvedValue({
                email: 'pat@example.com',
                role: Role.PATIENT,
            });
            userRepository.findOne.mockResolvedValue({ _id: new Types.ObjectId() });

            await expect(guard.canActivate(contextFor(authed()))).resolves.toBe(true);
        });

        // The token's own role picks the collection. The legacy guards ignored the claim
        // and looked the caller up in whichever repository they were hardcoded to, so one
        // email existing in two collections was enough to cross roles.
        it('resolves the caller from the collection its role names', async () => {
            jwtService.verifyAsync.mockResolvedValue({
                email: 'admin@example.com',
                role: Role.ADMIN,
            });
            adminRepository.findOne.mockResolvedValue({ _id: new Types.ObjectId() });

            await expect(guard.canActivate(contextFor(authed()))).resolves.toBe(true);
            expect(adminRepository.findOne).toHaveBeenCalledWith({
                email: 'admin@example.com',
            });
            expect(doctorRepository.findOne).not.toHaveBeenCalled();
            expect(userRepository.findOne).not.toHaveBeenCalled();
        });

        it('rejects a token with no role claim', async () => {
            jwtService.verifyAsync.mockResolvedValue({ email: 'who@example.com' });

            await expect(guard.canActivate(contextFor(authed()))).rejects.toThrow(
                /missing role claim/,
            );
        });

        it('rejects a role that matches no repository', async () => {
            jwtService.verifyAsync.mockResolvedValue({
                email: 'who@example.com',
                role: 'superuser',
            });

            await expect(guard.canActivate(contextFor(authed()))).rejects.toThrow(
                /not found/,
            );
        });
    });

    describe('token handling', () => {
        it('rejects a request with no Authorization header', async () => {
            await expect(
                guard.canActivate(contextFor({ headers: {} })),
            ).rejects.toThrow(/Missing authorization token/);

            expect(jwtService.verifyAsync).not.toHaveBeenCalled();
        });

        it('rejects a non-Bearer Authorization scheme', async () => {
            await expect(
                guard.canActivate(
                    contextFor({ headers: { authorization: 'Basic a.b.c' } }),
                ),
            ).rejects.toThrow(/Missing authorization token/);
        });

        it('translates a failed verification into 401 rather than letting it escape', async () => {
            jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

            await expect(
                guard.canActivate(contextFor(authed())),
            ).rejects.toThrow(/Invalid or expired token/);
        });

        it('rejects when the account behind a valid token no longer exists', async () => {
            jwtService.verifyAsync.mockResolvedValue({
                email: 'gone@example.com',
                role: Role.PATIENT,
            });
            userRepository.findOne.mockResolvedValue(null);

            await expect(guard.canActivate(contextFor(authed()))).rejects.toThrow(
                /not found/,
            );
        });
    });

    describe('request attachment', () => {
        it('attaches the caller uniformly and under the legacy key', async () => {
            const request = authed();
            const doctor = { _id: new Types.ObjectId(), active: true };
            jwtService.verifyAsync.mockResolvedValue({
                email: 'doc@example.com',
                role: Role.DOCTOR,
            });
            doctorRepository.findOne.mockResolvedValue(doctor);

            await guard.canActivate(contextFor(request));

            expect(request.user).toBe(doctor);
            expect(request.userRole).toBe(Role.DOCTOR);
            // Controllers not yet migrated off the legacy guards still read req.doctor.
            expect(request.doctor).toBe(doctor);
            expect(request.patient).toBeUndefined();
            expect(request.admin).toBeUndefined();
        });

        it('attaches a patient under req.patient, not req.doctor', async () => {
            const request = authed();
            const patient = { _id: new Types.ObjectId() };
            jwtService.verifyAsync.mockResolvedValue({
                email: 'pat@example.com',
                role: Role.PATIENT,
            });
            userRepository.findOne.mockResolvedValue(patient);

            await guard.canActivate(contextFor(request));

            expect(request.patient).toBe(patient);
            expect(request.doctor).toBeUndefined();
        });
    });
});

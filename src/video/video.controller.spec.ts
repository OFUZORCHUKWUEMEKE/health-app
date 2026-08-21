import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Role } from 'src/common/enums';
import { VideoController } from './video.controller';

/**
 * Pins the guard wiring rather than the handler bodies, which video.service.spec.ts
 * already covers. Decorators are easy to drop in an edit and nothing else would notice:
 * a missing @Roles() silently downgrades a route to "any authenticated user", and a
 * missing @UseGuards opens it entirely.
 */
describe('VideoController authorization wiring', () => {
    const reflector = new Reflector();

    const handlers: Array<[string, Role]> = [
        ['getDoctorToken', Role.DOCTOR],
        ['getPatientToken', Role.PATIENT],
        ['startSession', Role.DOCTOR],
        ['endSession', Role.DOCTOR],
    ];

    it.each(handlers)('%s is guarded by RolesGuard', (handler) => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            VideoController.prototype[handler],
        );

        expect(guards).toContain(RolesGuard);
    });

    it.each(handlers)('%s requires exactly the %s role', (handler, role) => {
        const roles = reflector.get<Role[]>(
            ROLES_KEY,
            VideoController.prototype[handler],
        );

        expect(roles).toEqual([role]);
    });

    // The legacy guards never checked doctor.active, so leaving one behind on any route
    // would quietly reopen the hole this migration closed.
    it('has no route left on the legacy guards', () => {
        const legacyNames = ['DoctorGuard', 'PatientGuard', 'GeneralGuard', 'AdminGuard'];

        for (const [handler] of handlers) {
            const guards: any[] =
                Reflect.getMetadata(
                    GUARDS_METADATA,
                    VideoController.prototype[handler],
                ) ?? [];

            expect(guards.map((g) => g?.name)).not.toEqual(
                expect.arrayContaining(legacyNames),
            );
        }
    });
});

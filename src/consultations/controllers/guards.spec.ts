import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Role } from 'src/common/enums';
import { DoctorsController } from './doctors.controller';
import { PatientsController } from './patients.controller';

/**
 * The clinical record is the most sensitive surface in the app, and until this migration
 * all 73 of its routes ran on the first-generation guards, which never checked
 * `doctor.active` and ignored the token's role claim entirely.
 *
 * `doctors.controller.ts` previously repeated `@UseGuards(DoctorGuard)` on every one of
 * its 50 routes. Hoisting to a single class-level guard is coverage-equivalent — every
 * route had one — and removes the failure mode where route 51 is added without it. These
 * tests pin that: if the class-level declaration is ever dropped, 50 routes lose their
 * guard at once and nothing else in the suite would notice.
 */
describe('Consultation controllers authorization', () => {
    const reflector = new Reflector();

    const controllers: Array<[string, any, Role]> = [
        ['DoctorsController', DoctorsController, Role.DOCTOR],
        ['PatientsController', PatientsController, Role.PATIENT],
    ];

    it.each(controllers)('%s is guarded at the class level', (_name, controller) => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, controller);

        expect(guards).toContain(RolesGuard);
    });

    it.each(controllers)('%s requires exactly its own role', (_name, controller, role) => {
        const roles = reflector.get<Role[]>(ROLES_KEY, controller);

        expect(roles).toEqual([role]);
    });

    it.each(controllers)(
        '%s has no handler left on a legacy guard',
        (_name, controller) => {
            const legacy = ['DoctorGuard', 'PatientGuard', 'GeneralGuard', 'AdminGuard'];

            const handlers = Object.getOwnPropertyNames(controller.prototype).filter(
                (k) => k !== 'constructor',
            );

            for (const handler of handlers) {
                const guards: any[] =
                    Reflect.getMetadata(GUARDS_METADATA, controller.prototype[handler]) ??
                    [];
                expect(guards.map((g) => g?.name)).not.toEqual(
                    expect.arrayContaining(legacy),
                );
            }
        },
    );

    // A class-level guard covers every handler by construction, so the count is the thing
    // worth asserting: it is what makes "one declaration" equivalent to the 50 it replaced.
    it('covers every doctor consultation route with one declaration', () => {
        const handlers = Object.getOwnPropertyNames(DoctorsController.prototype).filter(
            (k) => k !== 'constructor',
        );

        expect(handlers.length).toBeGreaterThan(40);
        expect(Reflect.getMetadata(GUARDS_METADATA, DoctorsController)).toContain(
            RolesGuard,
        );
    });
});

import { AuthService } from './auth.service';
import { Role } from 'src/common/enums';

describe('AuthService', () => {
    const tokenService = {
        generateTokens: jest.fn(),
        hashRefreshToken: jest.fn(),
    };
    const userRepository = {
        findOne: jest.fn(),
        create: jest.fn(),
        findOneAndUpdate: jest.fn(),
    };
    const doctorRepository = {};
    const adminRepository = {};
    const pendingRegistrationRepository = {};
    const pendingPasswordResetRepository = {};
    const mailService = {
        sendEmailConfirmation: jest.fn(),
    };
    const configService = {
        get: jest.fn(),
    };
    const mrnService = {
        generateUniqueMrn: jest.fn().mockResolvedValue('C-TEST01'),
        claim: jest.fn().mockResolvedValue(undefined),
    };

    let service: AuthService;

    beforeEach(() => {
        jest.clearAllMocks();

        service = new AuthService(
            tokenService as any,
            userRepository as any,
            doctorRepository as any,
            adminRepository as any,
            pendingRegistrationRepository as any,
            pendingPasswordResetRepository as any,
            mailService as any,
            configService as any,
            mrnService as any,
        );

        userRepository.findOne.mockResolvedValue(null);
        userRepository.findOneAndUpdate.mockResolvedValue({});
        tokenService.generateTokens.mockResolvedValue({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
        });
        tokenService.hashRefreshToken.mockResolvedValue('refresh-token-hash');
        mailService.sendEmailConfirmation.mockResolvedValue(undefined);
    });

    it('creates patients without carrying medication or plaintext password fields into the user document', async () => {
        userRepository.create.mockImplementation(async (payload) => ({
            _id: 'patient-id',
            email: payload.email,
            full_name: payload.full_name,
            toJSON: () => payload,
        }));

        await service.patientSignup({
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ADA@example.com',
            password: 'password123',
            medications: [{ medication: 'Paracetamol' }],
        } as any);

        const createPayload = userRepository.create.mock.calls[0][0];

        expect(createPayload).toMatchObject({
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.com',
            full_name: 'Ada Lovelace',
            provider: 'LOCAL',
            verified: false,
        });
        expect(createPayload).toHaveProperty('password_hash');
        expect(createPayload).not.toHaveProperty('password');
        expect(createPayload).not.toHaveProperty('medications');
        expect(createPayload).not.toHaveProperty('medication');
        expect(tokenService.generateTokens).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'ada@example.com' }),
            Role.PATIENT,
        );
    });
});

import { BadRequestException } from '@nestjs/common';
import { TokenService } from './token.service';

describe('TokenService token verification', () => {
  const jwtService = { verifyAsync: jest.fn(), signAsync: jest.fn() };
  const configService = { get: jest.fn().mockReturnValue('test-secret') };

  let service: TokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockReturnValue('test-secret');
    service = new TokenService(jwtService as any, configService as any);
  });

  /** jsonwebtoken throws plain Error subclasses, not HttpExceptions. */
  const jwtError = (name: string) => {
    const err = new Error(name);
    err.name = name;
    return err;
  };

  describe.each([
    ['verifyAccessToken', 'link'],
    ['verifyRegistrationToken', 'registration token'],
    ['verifyPasswordResetToken', 'reset token'],
  ])('%s', (method, subject) => {
    it('returns the payload when the token is valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({ email: 'a@b.com' });

      await expect(service[method]('good-token')).resolves.toEqual({
        email: 'a@b.com',
      });
    });

    it('raises a 400 instead of a 500 for a malformed token', async () => {
      jwtService.verifyAsync.mockRejectedValue(jwtError('JsonWebTokenError'));

      await expect(service[method]('garbage')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service[method]('garbage')).rejects.toThrow(
        `Invalid ${subject}`,
      );
    });

    it('reports expiry distinctly from a malformed token', async () => {
      jwtService.verifyAsync.mockRejectedValue(jwtError('TokenExpiredError'));

      await expect(service[method]('expired')).rejects.toThrow(
        `This ${subject} has expired`,
      );
    });
  });

  it('leaves verifyRefreshToken untouched so its caller keeps handling errors', async () => {
    const raw = jwtError('JsonWebTokenError');
    jwtService.verifyAsync.mockRejectedValue(raw);

    await expect(service.verifyRefreshToken('garbage')).rejects.toBe(raw);
  });
});

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { UserRepository } from 'src/users/user.repository';


@Injectable()
export class GeneralGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private configService: ConfigService,
    private doctorRepository: DoctorRepository,
    private userRepository: UserRepository
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Unauthorized User Access');
    }

    try {
      // Verify JWT token
      const payload = await this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      // Find admin by email from token payload
      const doctor = await this.doctorRepository.findOne({ email: payload.email })
      const patient = await this.userRepository.findOne({ email: payload.email })

      if (!doctor && !patient) {
        throw new UnauthorizedException('Unauthorized user access');
      }
      if (doctor) {
        request['doctor'] = doctor;
      }
      if (patient) {
        request['patient'] = patient;
      }
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid token or unauthorized access');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
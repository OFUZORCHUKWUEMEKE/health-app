import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from "mongoose"
import { Admin } from "../../admin/admin.model"
import { AdminRepository } from 'src/admin/admin.repository';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { UserRepository } from 'src/users/user.repository';


@Injectable()
export class PatientGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private configService: ConfigService,
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
      const patient = await this.userRepository.findOne({ email: payload.email })

      if (!patient) {
        throw new UnauthorizedException('Unauthorized user access');
      }

      // Attach admin to request for downstream use
      request['patient'] = patient;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid token or unauthorized access');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    // console.log('Authorization Header:', request.headers.authorization);
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    // console.log('Extracted Token:', token);
    return type === 'Bearer' ? token : undefined;
  }
}
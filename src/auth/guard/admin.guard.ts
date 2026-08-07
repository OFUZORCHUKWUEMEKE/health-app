import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from "mongoose"
import { Admin } from "../../admin/admin.model"
import { AdminRepository } from 'src/admin/admin.repository';


@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private configService: ConfigService,
    private adminRepository: AdminRepository,
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
      const admin = await this.adminRepository.findOne({ email: payload.email })

      if (!admin) {
        throw new UnauthorizedException('User is not an admin');
      }

      // Attach admin to request for downstream use
      request['admin'] = admin;
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
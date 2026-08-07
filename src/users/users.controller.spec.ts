import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from './user.repository';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { AdminRepository } from 'src/admin/admin.repository';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    // Add your mock methods here
  };

  const mockCloudinaryService = {
    // Add your mock methods here
  };

  const mockRolesGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  const mockUserRepository = {};
  const mockDoctorRepository = {};
  const mockAdminRepository = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: RolesGuard, useValue: mockRolesGuard },
        { provide: Reflector, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: DoctorRepository, useValue: mockDoctorRepository },
        { provide: AdminRepository, useValue: mockAdminRepository },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
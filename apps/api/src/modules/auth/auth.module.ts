import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { RegistrationInviteService } from './registration-invite.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolePermissionsController } from './role-permissions.controller';
import { RolePermissionsModule } from './role-permissions.module';
@Module({
  imports: [
    RolePermissionsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get('JWT_ACCESS_EXPIRY', '15m') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, RolePermissionsController],
  providers: [AuthService, MfaService, RegistrationInviteService, JwtStrategy],
  exports: [AuthService, RegistrationInviteService, JwtModule],
})
export class AuthModule {}

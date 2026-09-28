import { Role } from '../constants/enums';

export interface LoginRequest {
  email: string;
  password: string;
  deviceFingerprint: string;
  tenantId?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
  mfaRequired?: boolean;
  mfaToken?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  tenantId: string;
  mfaEnabled: boolean;
}

export interface JwtPayload {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  roles: Role[];
  permissions: string[];
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface DeviceInfo {
  fingerprint: string;
  userAgent: string;
  ipAddress: string;
  browser?: string;
  os?: string;
  isTrusted: boolean;
}

import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, JwtPayload } from '@cbt/shared';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RolePermissionsService } from '../../modules/auth/role-permissions.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rolePermissions: RolePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const { permissions } = await this.rolePermissions.effectiveForRoles(user.tenantId, user.roles ?? []);
    const granted = new Set(permissions);
    const hasAllPermissions = requiredPermissions.every((permission) => granted.has(permission));

    if (!hasAllPermissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}

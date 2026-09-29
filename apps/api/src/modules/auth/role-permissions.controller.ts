import { Body, Controller, ForbiddenException, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Role } from '@cbt/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolePermissionsService } from './role-permissions.service';

@ApiTags('Role Permissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('role-permissions')
export class RolePermissionsController {
  constructor(private rolePermissions: RolePermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'Role permission matrix for this institute' })
  matrix(@CurrentUser() user: JwtPayload) {
    this.assertSuperAdmin(user.roles);
    return this.rolePermissions.matrix(user.tenantId);
  }

  @Put()
  @ApiOperation({ summary: 'Save or reset a role permission matrix' })
  save(
    @CurrentUser() user: JwtPayload,
    @Body() body: { role?: string; permissions?: string[]; reset?: boolean; userId?: string },
  ) {
    this.assertSuperAdmin(user.roles);
    return this.rolePermissions.save(user.tenantId, body);
  }

  private assertSuperAdmin(roles: Role[] | undefined) {
    if (!(roles ?? []).some((role) => role.toUpperCase() === 'SUPER_ADMIN')) {
      throw new ForbiddenException('Only a super admin can manage role permissions');
    }
  }
}

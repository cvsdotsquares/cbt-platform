import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '@cbt/shared';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  @RequirePermissions(Permission.USER_CREATE)
  @ApiOperation({ summary: 'Create a new user' })
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { email: string; password: string; firstName: string; lastName: string; roleIds?: string[] },
  ) {
    return this.usersService.create(tenantId, body);
  }

  @Get('meta/roles')
  @RequirePermissions(Permission.USER_READ)
  @ApiOperation({ summary: 'List available roles' })
  getRoles(@CurrentUser('roles') roles: string[]) {
    return this.usersService.getRoles(roles);
  }

  @Get()
  @RequirePermissions(Permission.USER_READ)
  @ApiOperation({ summary: 'List users' })
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.usersService.findAll(tenantId, page, limit, search);
  }

  @Get(':id')
  @RequirePermissions(Permission.USER_READ)
  @ApiOperation({ summary: 'Get user details' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.findOne(id, tenantId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USER_UPDATE)
  @ApiOperation({ summary: 'Update user profile, status, or single staff role' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') assignedBy: string,
    @Body() body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
      password?: string;
      roleId?: string | null;
    },
  ) {
    return this.usersService.update(id, tenantId, body, assignedBy);
  }

  @Delete(':id')
  @RequirePermissions(Permission.USER_DELETE)
  @ApiOperation({ summary: 'Deactivate user account' })
  remove(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') currentUserId: string,
  ) {
    return this.usersService.remove(id, tenantId, currentUserId);
  }

  @Post(':id/roles')
  @RequirePermissions(Permission.USER_ASSIGN_ROLE)
  @ApiOperation({ summary: 'Assign role to user' })
  assignRole(
    @Param('id') userId: string,
    @Body('roleId') roleId: string,
    @CurrentUser('sub') assignedBy: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.assignRole(userId, roleId, assignedBy, tenantId);
  }

  @Delete(':id/roles/:roleId')
  @RequirePermissions(Permission.USER_ASSIGN_ROLE)
  @ApiOperation({ summary: 'Remove role from user' })
  removeRole(
    @Param('id') userId: string,
    @Param('roleId') roleId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.removeRole(userId, roleId, tenantId);
  }
}

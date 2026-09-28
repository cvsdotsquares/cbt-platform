import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '@cbt/shared';
import { UpdateBrandingDto } from './dto/update-branding.dto';

@ApiTags('Tenants')
@Controller('tenants')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Post()
  @RequirePermissions(Permission.TENANT_CREATE)
  @ApiOperation({ summary: 'Create a new tenant' })
  create(@Body() body: { name: string; slug: string; domain?: string }) {
    return this.tenantsService.create(body);
  }

  @Get()
  @RequirePermissions(Permission.TENANT_READ)
  @ApiOperation({ summary: 'List all tenants' })
  findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.tenantsService.findAll(page, limit);
  }

  @Get('me/branding')
  @ApiOperation({ summary: 'Get branding for the current user\'s institute (all roles)' })
  getMyBranding(@CurrentUser('tenantId') tenantId: string) {
    return this.tenantsService.getBranding(tenantId);
  }

  @Get(':id')
  @RequirePermissions(Permission.TENANT_READ)
  @ApiOperation({ summary: 'Get tenant details' })
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id/branding')
  @RequirePermissions(Permission.TENANT_BRANDING)
  @ApiOperation({ summary: 'Update tenant branding' })
  updateBranding(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() branding: UpdateBrandingDto,
  ) {
    if (id !== tenantId) throw new ForbiddenException('Cannot update another tenant');
    return this.tenantsService.updateBranding(id, branding as Record<string, unknown>);
  }

  @Patch(':id/security')
  @RequirePermissions(Permission.TENANT_SECURITY_CONFIG)
  @ApiOperation({ summary: 'Update tenant security config' })
  updateSecurity(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() config: Record<string, unknown>,
  ) {
    if (id !== tenantId) throw new ForbiddenException('Cannot update another tenant');
    return this.tenantsService.updateSecurityConfig(id, config);
  }
}

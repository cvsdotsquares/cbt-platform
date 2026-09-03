import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '@cbt/shared';

@ApiTags('Onboarding')
@Controller('onboarding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  @Get('setup-status')
  @RequirePermissions(Permission.TENANT_READ)
  getSetupStatus(@CurrentUser('tenantId') tenantId: string) {
    return this.onboardingService.getSetupStatus(tenantId);
  }
}

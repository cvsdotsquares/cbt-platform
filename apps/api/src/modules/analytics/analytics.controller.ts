import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '@cbt/shared';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermissions(Permission.ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Dashboard statistics' })
  getDashboard(@CurrentUser('tenantId') tenantId: string) {
    return this.analyticsService.getDashboardStats(tenantId);
  }

  @Get('exam/:examId')
  @RequirePermissions(Permission.ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Exam analytics' })
  getExamAnalytics(
    @Param('examId') examId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.analyticsService.getExamAnalytics(examId, tenantId);
  }
}

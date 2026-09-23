import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ProctoringService } from '../proctoring/proctoring.service';
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
  constructor(
    private analyticsService: AnalyticsService,
    private proctoringService: ProctoringService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(Permission.ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Dashboard statistics' })
  getDashboard(@CurrentUser('tenantId') tenantId: string) {
    return this.analyticsService.getDashboardStats(tenantId);
  }

  @Get('dashboard/submissions')
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({ summary: 'Exam submissions for a local calendar day (from/to ISO bounds)' })
  getDashboardSubmissions(
    @CurrentUser('tenantId') tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!from?.trim() || !to?.trim() || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid from/to');
    }
    if (toDate <= fromDate) {
      throw new BadRequestException("'to' must be after 'from'");
    }
    return this.analyticsService.getSubmissionsInRange(tenantId, fromDate, toDate);
  }

  @Get('violations/:eventId')
  @RequirePermissions(Permission.ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Integrity violation detail for dashboard alerts' })
  getViolationDetail(
    @Param('eventId') eventId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.proctoringService.getEventDetail(eventId, tenantId);
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

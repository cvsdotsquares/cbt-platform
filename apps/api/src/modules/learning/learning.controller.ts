import { Controller, Get, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LearningService } from './learning.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission, type JwtPayload } from '@cbt/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isTeacherScoped,
  teacherHasBatchAccess,
  teacherHasSubjectAccess,
} from '../../common/utils/teacher-scope.util';

@ApiTags('Learning')
@Controller('learning')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LearningController {
  constructor(
    private learningService: LearningService,
    private prisma: PrismaService,
  ) {}

  @Get('student/dashboard')
  @RequirePermissions(Permission.LEARNING_READ)
  @ApiOperation({ summary: 'Student learning dashboard' })
  async studentDashboard(@CurrentUser('sub') userId: string, @CurrentUser('tenantId') tenantId: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { userId } });
    if (!candidate) return { error: 'Student profile not found' };
    return this.learningService.getStudentDashboard(candidate.id, tenantId);
  }

  @Get('student/recommendations')
  @RequirePermissions(Permission.LEARNING_READ)
  async recommendations(@CurrentUser('sub') userId: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { userId } });
    if (!candidate) return [];
    return this.learningService.getRecommendations(candidate.id);
  }

  @Get('teacher/batch/:batchId/analytics')
  @RequirePermissions(Permission.LEARNING_MANAGE)
  @ApiOperation({ summary: 'Teacher batch analytics' })
  async teacherAnalytics(
    @Param('batchId') batchId: string,
    @CurrentUser() user: JwtPayload,
    @Query('subjectId') subjectId?: string,
  ) {
    if (isTeacherScoped(user)) {
      const allowed = await teacherHasBatchAccess(this.prisma, user.sub, batchId);
      if (!allowed) throw new ForbiddenException('You are not assigned to this class');
      if (subjectId) {
        const subjectOk = await teacherHasSubjectAccess(this.prisma, user.sub, batchId, subjectId);
        if (!subjectOk) throw new ForbiddenException('You are not assigned to this subject');
      }
    }
    return this.learningService.getTeacherAnalytics(user.tenantId, batchId, subjectId);
  }
}

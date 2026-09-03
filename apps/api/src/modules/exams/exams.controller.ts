import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ExamsService } from './exams.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission, type JwtPayload } from '@cbt/shared';
import { isTeacherScoped } from '../../common/utils/teacher-scope.util';

@ApiTags('Exams')
@Controller('exams')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ExamsController {
  constructor(private examsService: ExamsService) {}

  @Post()
  @RequirePermissions(Permission.EXAM_CREATE)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.examsService.create(tenantId, userId, body as never);
  }

  @Get('my/available')
  @RequirePermissions(Permission.EXAM_TAKE)
  @ApiOperation({ summary: 'Get exams available for candidate' })
  myExams(@CurrentUser('sub') userId: string) {
    return this.examsService.getAvailableForCandidate(userId);
  }

  @Get(':id/instructions')
  @RequirePermissions(Permission.EXAM_TAKE)
  @ApiOperation({ summary: 'Get exam instructions for registered candidate (no answers)' })
  instructions(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.examsService.getInstructionsForCandidate(id, userId);
  }

  @Get()
  @RequirePermissions(Permission.EXAM_READ)
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const createdById = isTeacherScoped(user) ? user.sub : undefined;
    return this.examsService.findAll(user.tenantId, page, limit, createdById);
  }

  @Get(':id')
  @RequirePermissions(Permission.EXAM_READ)
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.examsService.findOne(id, tenantId);
  }

  @Post(':id/questions')
  @RequirePermissions(Permission.EXAM_UPDATE)
  @ApiOperation({ summary: 'Add questions to exam section' })
  addQuestions(
    @Param('id') examId: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { sectionId: string; questionIds: string[] },
  ) {
    return this.examsService.addQuestions(examId, tenantId, userId, body.sectionId, body.questionIds);
  }

  @Post(':id/publish')
  @RequirePermissions(Permission.EXAM_PUBLISH)
  publish(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.examsService.publish(id, tenantId);
  }

  @Patch(':id/schedule')
  @RequirePermissions(Permission.EXAM_UPDATE)
  @ApiOperation({ summary: 'Update exam schedule, duration, and timezone' })
  updateSchedule(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { startTime: string; endTime: string; timezone?: string; durationMinutes?: number },
  ) {
    return this.examsService.updateSchedule(id, tenantId, body);
  }

  @Post(':id/candidates')
  @RequirePermissions(Permission.EXAM_ASSIGN_CANDIDATES)
  assignCandidates(
    @Param('id') examId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body('candidateIds') candidateIds: string[],
  ) {
    return this.examsService.assignCandidates(examId, tenantId, candidateIds);
  }

  @Put(':id/candidates')
  @RequirePermissions(Permission.EXAM_ASSIGN_CANDIDATES)
  @ApiOperation({ summary: 'Sync exam students (draft only)' })
  syncCandidates(
    @Param('id') examId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body('candidateIds') candidateIds: string[],
  ) {
    return this.examsService.syncCandidates(examId, tenantId, candidateIds ?? []);
  }

  @Delete(':id/questions/:questionId')
  @RequirePermissions(Permission.EXAM_UPDATE)
  @ApiOperation({ summary: 'Remove question from draft exam' })
  removeQuestion(
    @Param('id') examId: string,
    @Param('questionId') questionId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.examsService.removeQuestion(examId, tenantId, questionId);
  }

  @Delete(':id')
  @RequirePermissions(Permission.EXAM_DELETE)
  @ApiOperation({ summary: 'Delete exam permanently' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.examsService.remove(id, tenantId);
  }
}

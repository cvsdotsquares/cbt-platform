import { Controller, Get, Post, Patch, Param, Query, Body, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ResultsService } from './results.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission, type JwtPayload } from '@cbt/shared';
import { isTeacherScoped } from '../../common/utils/teacher-scope.util';

@ApiTags('Results')
@Controller('results')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ResultsController {
  constructor(private resultsService: ResultsService) {}

  private async assertTeacherExamAccess(user: JwtPayload, examId: string) {
    if (isTeacherScoped(user)) {
      await this.resultsService.assertTeacherOwnsExam(examId, user.sub);
    }
  }

  private async assertTeacherSessionAccess(user: JwtPayload, sessionId: string) {
    if (isTeacherScoped(user)) {
      await this.resultsService.assertTeacherOwnsSession(sessionId, user.sub);
    }
  }

  @Get('verify/:resultId')
  @Public()
  @ApiOperation({ summary: 'Public certificate verification' })
  verifyCertificate(@Param('resultId') resultId: string) {
    return this.resultsService.verifyCertificate(resultId);
  }

  @Get('my')
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({ summary: 'Get my results' })
  getMyResults(@CurrentUser('sub') userId: string) {
    return this.resultsService.getMyResults(userId);
  }

  @Get('my/:resultId/certificate')
  @RequirePermissions(Permission.RESULT_CERTIFICATE)
  @ApiOperation({ summary: 'Get certificate for a published result' })
  getCertificate(
    @CurrentUser('sub') userId: string,
    @Param('resultId') resultId: string,
  ) {
    return this.resultsService.getCertificate(userId, resultId);
  }

  @Get('review/:resultId')
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({ summary: 'Question-level answer review for a result' })
  getResultReview(
    @CurrentUser() user: JwtPayload,
    @Param('resultId') resultId: string,
  ) {
    return this.resultsService.getResultReview(user, resultId);
  }

  @Post('evaluate/:sessionId')
  @RequirePermissions(Permission.RESULT_EVALUATE)
  async evaluate(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertTeacherSessionAccess(user, sessionId);
    return this.resultsService.evaluateSession(sessionId);
  }

  @Post('rank/:examId')
  @RequirePermissions(Permission.RESULT_RANK)
  async calculateRanks(
    @Param('examId') examId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertTeacherExamAccess(user, examId);
    return this.resultsService.calculateRanks(examId);
  }

  @Post('publish/:examId')
  @RequirePermissions(Permission.RESULT_PUBLISH)
  async publish(
    @Param('examId') examId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertTeacherExamAccess(user, examId);
    return this.resultsService.publishResults(examId);
  }

  @Get('exam/:examId/subjective')
  @RequirePermissions(Permission.RESULT_EVALUATE)
  async getSubjectiveResponses(
    @Param('examId') examId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertTeacherExamAccess(user, examId);
    return this.resultsService.getSubjectiveResponses(examId);
  }

  @Patch('grade/:sessionId/:questionId')
  @RequirePermissions(Permission.RESULT_EVALUATE)
  async gradeResponse(
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
    @Body('marksAwarded') marksAwarded: number,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertTeacherSessionAccess(user, sessionId);
    return this.resultsService.gradeResponse(sessionId, questionId, marksAwarded);
  }

  @Get('exam/:examId')
  @RequirePermissions(Permission.RESULT_READ)
  async getExamResults(
    @Param('examId') examId: string,
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    await this.assertTeacherExamAccess(user, examId);
    return this.resultsService.getExamResults(examId, page, limit);
  }

  @Get('exam/:examId/export')
  @RequirePermissions(Permission.RESULT_READ)
  async exportExamResults(
    @Param('examId') examId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    await this.assertTeacherExamAccess(user, examId);
    const csv = await this.resultsService.exportExamResultsCsv(examId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="results-${examId}.csv"`);
    res.send(csv);
  }
}

import { Controller, Post, Get, Param, Body, Req, UseGuards } from '@nestjs/common';

import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { Request } from 'express';

import { ExamEngineService } from './exam-engine.service';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { PermissionsGuard } from '../../common/guards/permissions.guard';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';

import { Permission } from '@cbt/shared';



@ApiTags('Exam Engine')

@Controller('exam-sessions')

@UseGuards(JwtAuthGuard, PermissionsGuard)

@ApiBearerAuth()

export class ExamEngineController {

  constructor(private examEngineService: ExamEngineService) {}



  @Post('start')

  @RequirePermissions(Permission.EXAM_TAKE)

  @ApiOperation({ summary: 'Start an exam session' })

  start(

    @Body('examId') examId: string,

    @CurrentUser('sub') userId: string,

    @Req() req: Request,

  ) {

    return this.examEngineService.startSessionByUser(

      examId,

      userId,

      req.ip || 'unknown',

      (req.headers['x-device-fingerprint'] as string) || 'unknown',

    );

  }



  @Get(':id')

  @RequirePermissions(Permission.EXAM_TAKE)

  @ApiOperation({ summary: 'Get exam session state' })

  async getSession(@Param('id') sessionId: string, @CurrentUser('sub') userId: string) {

    const { candidateId } = await this.examEngineService.assertSessionOwner(sessionId, userId);

    return this.examEngineService.getSessionState(sessionId, candidateId);

  }



  @Post(':id/responses')

  @RequirePermissions(Permission.EXAM_TAKE)

  @ApiOperation({ summary: 'Save answer' })

  saveAnswer(

    @Param('id') sessionId: string,

    @CurrentUser('sub') userId: string,

    @Body() body: { questionId: string; answer: unknown; timeSpentSeconds: number; markedForReview?: boolean },

  ) {

    return this.examEngineService.saveAnswer(

      sessionId,

      userId,

      body.questionId,

      body.answer,

      body.timeSpentSeconds,

      body.markedForReview,

    );

  }



  @Post(':id/mark-review')

  @RequirePermissions(Permission.EXAM_TAKE)

  @ApiOperation({ summary: 'Mark question for review' })

  markReview(

    @Param('id') sessionId: string,

    @CurrentUser('sub') userId: string,

    @Body() body: { questionId: string; marked: boolean },

  ) {

    return this.examEngineService.markForReview(sessionId, userId, body.questionId, body.marked);

  }



  @Post(':id/submit')

  @RequirePermissions(Permission.EXAM_SUBMIT)

  @ApiOperation({ summary: 'Submit exam' })

  submit(
    @Param('id') sessionId: string,
    @CurrentUser('sub') userId: string,
    @Body() body?: {
      answers?: {
        questionId: string;
        answer: unknown;
        timeSpentSeconds?: number;
        markedForReview?: boolean;
      }[];
    },
  ) {
    return this.examEngineService.submitSession(sessionId, userId, body?.answers);
  }

  @Post(':id/heartbeat')
  @RequirePermissions(Permission.EXAM_TAKE)
  @ApiOperation({ summary: 'Session heartbeat' })
  heartbeat(
    @Param('id') sessionId: string,
    @CurrentUser('sub') userId: string,
    @Body() body?: {
      answers?: {
        questionId: string;
        answer: unknown;
        timeSpentSeconds?: number;
        markedForReview?: boolean;
      }[];
    },
  ) {
    return this.examEngineService.heartbeat(sessionId, userId, body?.answers);
  }

}



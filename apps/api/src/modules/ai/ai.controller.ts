import { Controller, Post, Get, Param, Body, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiTestsService } from './ai-tests.service';
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
  getTeacherSubjectIdsForBatch,
} from '../../common/utils/teacher-scope.util';

@ApiTags('AI')
@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AiController {
  constructor(
    private aiService: AiService,
    private aiTestsService: AiTestsService,
    private prisma: PrismaService,
  ) {}

  private async assertTeacherCanGenerate(
    user: JwtPayload,
    opts: { batchId?: string; subjectId?: string; allSubjects?: boolean },
  ) {
    if (!isTeacherScoped(user)) return;

    if (!opts.batchId) {
      throw new BadRequestException('Teachers must select an assigned class batch');
    }
    const batchOk = await teacherHasBatchAccess(this.prisma, user.sub, opts.batchId);
    if (!batchOk) {
      throw new ForbiddenException('You are not assigned to this class');
    }

    if (opts.allSubjects) {
      throw new ForbiddenException('Teachers can only create tests for their assigned subjects');
    }

    if (!opts.subjectId) {
      throw new BadRequestException('Teachers must select an assigned subject');
    }
    const subjectOk = await teacherHasSubjectAccess(
      this.prisma,
      user.sub,
      opts.batchId,
      opts.subjectId,
    );
    if (!subjectOk) {
      throw new ForbiddenException('You are not assigned to this subject');
    }
  }

  @Get('status')
  @RequirePermissions(Permission.QUESTION_CREATE)
  @ApiOperation({ summary: 'Check AI / OpenAI configuration status' })
  getStatus() {
    return this.aiService.getStatus();
  }

  @Post('questions/generate')
  @RequirePermissions(Permission.QUESTION_CREATE)
  @ApiOperation({ summary: 'AI-generate exam questions' })
  generateQuestions(
    @Body() body: { topic: string; count?: number; difficulty?: string; type?: string },
  ) {
    return this.aiService.generateQuestions({
      topic: body.topic,
      count: Math.min(body.count || 3, 10),
      difficulty: body.difficulty || 'MEDIUM',
      type: body.type || 'MCQ',
    });
  }

  @Get('insights/exam/:examId')
  @RequirePermissions(Permission.ANALYTICS_VIEW)
  @ApiOperation({ summary: 'AI-powered exam insights' })
  getExamInsights(
    @Param('examId') examId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.aiService.getExamInsights(examId, tenantId);
  }

  @Post('chat')
  @RequirePermissions(Permission.TENANT_READ)
  @ApiOperation({ summary: 'AI assistant chat' })
  chat(
    @Body() body: { message: string; context?: { role?: string; page?: string } },
    @CurrentUser('sub') userId: string,
  ) {
    return this.aiService.chat(body.message, { ...body.context, role: userId });
  }

  @Post('proctoring/analyze')
  @RequirePermissions(Permission.EXAM_TAKE)
  @ApiOperation({ summary: 'Analyze proctoring frame with AI' })
  analyzeFrame(@Body() body: { sessionId: string; thumbnail: string }) {
    return this.aiService.processProctoringFrame(body.sessionId, body.thumbnail);
  }

  @Post('rag/generate')
  @RequirePermissions(Permission.AI_GENERATE_TEST)
  @ApiOperation({ summary: 'Generate RAG-grounded NCERT questions' })
  async generateRagQuestions(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      subjectId: string;
      batchId?: string;
      chapterIds?: string[];
      topicIds?: string[];
      syllabusScope?: string;
      count?: number;
      difficulty?: string;
      types?: string[];
      query?: string;
    },
  ) {
    await this.assertTeacherCanGenerate(user, {
      batchId: body.batchId,
      subjectId: body.subjectId,
    });

    return this.aiTestsService.generateRagQuestions({
      tenantId: user.tenantId,
      userId: user.sub,
      subjectId: body.subjectId,
      batchId: body.batchId,
      chapterIds: body.chapterIds,
      topicIds: body.topicIds,
      syllabusScope: body.syllabusScope as never,
      count: Math.min(body.count || 10, 20),
      difficulty: body.difficulty,
      types: body.types,
      query: body.query,
    });
  }

  @Post('tests/create')
  @RequirePermissions(Permission.AI_GENERATE_TEST)
  @ApiOperation({ summary: 'Create AI-generated test exam' })
  async createAiTest(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      title: string;
      batchId?: string;
      subjectId?: string;
      allSubjects?: boolean;
      chapterIds?: string[];
      topicIds?: string[];
      questionCount?: number;
      questionsPerSubject?: number;
      difficulty?: string;
      questionTypes?: string[];
      syllabusScope?: string;
      durationMinutes?: number;
      assignToBatch?: boolean;
    },
  ) {
    await this.assertTeacherCanGenerate(user, {
      batchId: body.batchId,
      subjectId: body.subjectId,
      allSubjects: body.allSubjects,
    });

    // Teachers always generate for a single assigned subject
    if (isTeacherScoped(user) && body.batchId && !body.subjectId) {
      const subjects = await getTeacherSubjectIdsForBatch(this.prisma, user.sub, body.batchId);
      if (subjects.length === 1) {
        body = { ...body, subjectId: subjects[0], allSubjects: false };
      }
    }

    return this.aiTestsService.createAiTest(user.tenantId, user.sub, body);
  }

  @Post('explain')
  @RequirePermissions(Permission.EXAM_VIEW_RESPONSE)
  @ApiOperation({ summary: 'Generate AI explanation for an answer' })
  explain(@Body() body: { questionText: string; correctAnswer: string; chapterId?: string }) {
    return this.aiTestsService.generateExplanation(body.questionText, body.correctAnswer);
  }
}

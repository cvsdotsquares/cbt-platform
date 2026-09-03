import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProctoringService } from './proctoring.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '@cbt/shared';

@ApiTags('Proctoring')
@Controller('proctoring')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ProctoringController {
  constructor(private proctoringService: ProctoringService) {}

  @Post('events')
  @RequirePermissions(Permission.EXAM_TAKE)
  @ApiOperation({ summary: 'Report proctoring event' })
  recordEvent(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      sessionId: string;
      eventType: string;
      confidence?: number;
      severity?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.proctoringService.recordEventForUser(
      userId,
      body.sessionId,
      body.eventType,
      {
        confidence: body.confidence,
        severity: body.severity as never,
        metadata: body.metadata,
      },
    );
  }

  @Get('sessions/:examId/live')
  @RequirePermissions(Permission.PROCTORING_MONITOR)
  @ApiOperation({ summary: 'Live monitoring data' })
  getLiveMonitoring(@Param('examId') examId: string) {
    return this.proctoringService.getLiveMonitoring(examId);
  }

  @Post('sessions/:id/intervene')
  @RequirePermissions(Permission.PROCTORING_INTERVENE)
  @ApiOperation({ summary: 'Proctor intervention' })
  intervene(
    @Param('id') sessionId: string,
    @Body() body: { type: string; message?: string },
  ) {
    return this.proctoringService.intervene(sessionId, body.type, body.message);
  }
}

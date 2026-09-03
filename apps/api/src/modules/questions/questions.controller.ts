import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QuestionsService } from './questions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '@cbt/shared';

@ApiTags('Questions')
@Controller('questions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class QuestionsController {
  constructor(private questionsService: QuestionsService) {}

  @Post()
  @RequirePermissions(Permission.QUESTION_CREATE)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.questionsService.create(tenantId, userId, body as never);
  }

  @Get()
  @RequirePermissions(Permission.QUESTION_READ)
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.questionsService.findAll(
      tenantId,
      {
        type: query.type as never,
        difficulty: query.difficulty as never,
        status: query.status as never,
        search: query.search,
      },
      query.page,
      query.limit,
    );
  }

  @Get(':id')
  @RequirePermissions(Permission.QUESTION_READ)
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.questionsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.QUESTION_UPDATE)
  @ApiOperation({ summary: 'Update question content and answers' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.questionsService.update(id, tenantId, userId, body as never);
  }

  @Post(':id/approve')
  @RequirePermissions(Permission.QUESTION_APPROVE)
  approve(@Param('id') id: string, @CurrentUser('sub') userId: string, @CurrentUser('tenantId') tenantId: string) {
    return this.questionsService.approve(id, userId, tenantId);
  }

  @Delete(':id')
  @RequirePermissions(Permission.QUESTION_DELETE)
  @ApiOperation({ summary: 'Delete question from bank' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.questionsService.remove(id, tenantId);
  }
}

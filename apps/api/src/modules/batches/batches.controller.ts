import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BatchesService } from './batches.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission, type JwtPayload } from '@cbt/shared';
import { isTeacherScoped } from '../../common/utils/teacher-scope.util';

@ApiTags('Batches')
@Controller('batches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class BatchesController {
  constructor(private batchesService: BatchesService) {}

  private teacherScope(user: JwtPayload) {
    return isTeacherScoped(user) ? user.sub : undefined;
  }

  @Get()
  @RequirePermissions(Permission.BATCH_READ)
  findAll(@CurrentUser() user: JwtPayload) {
    return this.batchesService.findAll(user.tenantId, this.teacherScope(user));
  }

  @Get('teacher-assignments')
  @RequirePermissions(Permission.BATCH_MANAGE)
  @ApiOperation({ summary: 'List teacher↔batch↔subject assignments (optional userId filter)' })
  listTeacherAssignmentsByUser(
    @CurrentUser('tenantId') tenantId: string,
    @Query('userId') userId?: string,
  ) {
    return this.batchesService.listTeacherAssignmentsByUser(tenantId, userId);
  }

  @Get(':id')
  @RequirePermissions(Permission.BATCH_READ)
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.batchesService.findOne(id, user.tenantId, this.teacherScope(user));
  }

  @Post()
  @RequirePermissions(Permission.BATCH_MANAGE)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { academicClassId: string; name: string; academicYear: string },
  ) {
    return this.batchesService.create(tenantId, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.BATCH_MANAGE)
  @ApiOperation({ summary: 'Update a batch' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { academicClassId?: string; name?: string; academicYear?: string; isActive?: boolean },
  ) {
    return this.batchesService.update(id, tenantId, body);
  }

  @Delete(':id')
  @RequirePermissions(Permission.BATCH_MANAGE)
  @ApiOperation({ summary: 'Delete a batch' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.batchesService.remove(id, tenantId);
  }

  @Post(':id/enroll')
  @RequirePermissions(Permission.BATCH_MANAGE)
  enroll(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { candidateId: string; rollNumber?: string },
  ) {
    return this.batchesService.enrollStudent(id, tenantId, body.candidateId, body.rollNumber);
  }

  @Get(':id/teachers')
  @RequirePermissions(Permission.BATCH_READ)
  @ApiOperation({ summary: 'List teachers assigned to a batch' })
  listTeachers(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.batchesService.listTeacherAssignments(id, tenantId);
  }

  @Post(':id/teachers')
  @RequirePermissions(Permission.BATCH_MANAGE)
  @ApiOperation({ summary: 'Assign a teacher to one or more subjects in a batch' })
  assignTeacher(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { userId: string; subjectId?: string; subjectIds?: string[] },
  ) {
    const subjectIds = body.subjectIds?.length
      ? body.subjectIds
      : body.subjectId
        ? [body.subjectId]
        : [];
    return this.batchesService.assignTeacher(id, tenantId, body.userId, subjectIds);
  }

  @Delete(':id/teachers/:assignmentId')
  @RequirePermissions(Permission.BATCH_MANAGE)
  @ApiOperation({ summary: 'Remove a teacher assignment from a batch' })
  removeTeacher(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.batchesService.removeTeacher(id, tenantId, assignmentId);
  }

  @Get(':id/syllabus-progress')
  @RequirePermissions(Permission.SYLLABUS_READ)
  getSyllabusProgress(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.batchesService.getSyllabusProgress(
      id,
      user.tenantId,
      subjectId,
      this.teacherScope(user),
    );
  }

  @Patch(':id/syllabus-progress')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  updateSyllabusProgress(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { chapterId?: string; topicId?: string; status: string },
  ) {
    return this.batchesService.updateSyllabusProgress(
      id,
      user.tenantId,
      { ...body, status: body.status as never },
      user.sub,
      this.teacherScope(user),
    );
  }

  @Post(':id/syllabus-progress/bulk')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  bulkUpdate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { chapterIds: string[]; status: string },
  ) {
    return this.batchesService.bulkUpdateChapterProgress(
      id,
      user.tenantId,
      body.chapterIds,
      body.status as never,
      user.sub,
      this.teacherScope(user),
    );
  }
}

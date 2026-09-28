import { Controller, Get, Post, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurriculumService } from './curriculum.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission, type JwtPayload } from '@cbt/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getTeacherSubjectIds,
  isTeacherScoped,
  teacherHasSubjectAssigned,
} from '../../common/utils/teacher-scope.util';

@ApiTags('Curriculum')
@Controller('curriculum')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CurriculumController {
  constructor(
    private curriculumService: CurriculumService,
    private prisma: PrismaService,
  ) {}

  private async teacherSubjectIds(user: JwtPayload) {
    if (!isTeacherScoped(user)) return undefined;
    return getTeacherSubjectIds(this.prisma, user.sub);
  }

  @Get('classes')
  @RequirePermissions(Permission.CURRICULUM_READ)
  @ApiOperation({ summary: 'List academic classes with full syllabus tree' })
  async getClasses(
    @CurrentUser() user: JwtPayload,
    @Query('uploadedOnly') uploadedOnly?: string,
  ) {
    const subjectIds = await this.teacherSubjectIds(user);
    if (uploadedOnly === 'true' || uploadedOnly === '1') {
      return this.curriculumService.getClassesFromUploads(user.tenantId, subjectIds);
    }
    return this.curriculumService.getClasses(user.tenantId, subjectIds);
  }

  @Get('classes/:id')
  @RequirePermissions(Permission.CURRICULUM_READ)
  async getClass(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tree = await this.curriculumService.getClassTree(id);
    if (!isTeacherScoped(user)) return tree;
    const subjectIds = await getTeacherSubjectIds(this.prisma, user.sub);
    return {
      ...tree,
      subjects: (tree as { subjects?: { id: string }[] }).subjects?.filter((s) =>
        subjectIds.includes(s.id),
      ) ?? [],
    };
  }

  @Get('subjects/:id/chapters')
  @RequirePermissions(Permission.CURRICULUM_READ)
  async getSubjectChapters(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    if (isTeacherScoped(user)) {
      const ok = await teacherHasSubjectAssigned(this.prisma, user.sub, id);
      if (!ok) throw new ForbiddenException('You are not assigned to this subject');
    }
    return this.curriculumService.getSubjectChapters(id);
  }

  @Post('classes')
  @RequirePermissions(Permission.CURRICULUM_MANAGE)
  createClass(@Body() body: { tenantId?: string; level: number; name: string; description?: string }) {
    return this.curriculumService.createClass(body);
  }

  @Post('subjects')
  @RequirePermissions(Permission.CURRICULUM_MANAGE)
  createSubject(@Body() body: { academicClassId: string; name: string; code: string; description?: string }) {
    return this.curriculumService.createSubject(body);
  }

  @Post('books')
  @RequirePermissions(Permission.CURRICULUM_MANAGE)
  createBook(@Body() body: { subjectId: string; title: string; publisher?: string; isNcert?: boolean }) {
    return this.curriculumService.createBook(body);
  }

  @Post('chapters')
  @RequirePermissions(Permission.CURRICULUM_MANAGE)
  createChapter(@Body() body: { bookId: string; number: number; title: string; description?: string }) {
    return this.curriculumService.createChapter(body);
  }

  @Post('topics')
  @RequirePermissions(Permission.CURRICULUM_MANAGE)
  createTopic(@Body() body: { chapterId: string; title: string; description?: string }) {
    return this.curriculumService.createSyllabusTopic(body);
  }
}

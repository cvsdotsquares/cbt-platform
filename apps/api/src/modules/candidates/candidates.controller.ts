import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CandidatesService } from './candidates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission, type JwtPayload } from '@cbt/shared';
import { getTeacherBatchIds, isTeacherScoped } from '../../common/utils/teacher-scope.util';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Candidates')
@Controller('candidates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CandidatesController {
  constructor(
    private candidatesService: CandidatesService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions(Permission.CANDIDATE_READ)
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('batchId') batchId?: string,
    @Query('academicClassId') academicClassId?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    const teacherScoped = isTeacherScoped(user);
    let batchIds: string[] | undefined;
    if (teacherScoped) {
      batchIds = await getTeacherBatchIds(this.prisma, user.sub);
      // Teachers cannot browse unassigned students tenant-wide
      if (unassigned === 'true' || unassigned === '1') {
        throw new ForbiddenException('Teachers can only view students in their assigned classes');
      }
      if (batchId && !batchIds.includes(batchId)) {
        throw new ForbiddenException('You are not assigned to this class');
      }
    }

    return this.candidatesService.findAll(user.tenantId, page, limit, search, {
      batchId,
      academicClassId,
      unassigned: unassigned === 'true' || unassigned === '1',
      batchIds: teacherScoped ? batchIds : undefined,
    });
  }

  @Post()
  @RequirePermissions(Permission.CANDIDATE_CREATE)
  @ApiOperation({ summary: 'Create a candidate account' })
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      registrationNumber?: string;
      batchId?: string;
      rollNumber?: string;
    },
  ) {
    return this.candidatesService.create(tenantId, body);
  }

  @Get('stats')
  @RequirePermissions(Permission.CANDIDATE_READ)
  getStats(@CurrentUser('tenantId') tenantId: string) {
    return this.candidatesService.getKycStats(tenantId);
  }

  @Post('me/kyc')
  @RequirePermissions(Permission.CANDIDATE_UPDATE)
  @ApiOperation({ summary: 'Submit KYC documents' })
  submitKyc(
    @CurrentUser('sub') userId: string,
    @Body() body: { documentType: string; idNumber: string; fileName: string; fileData: string },
  ) {
    return this.candidatesService.submitKyc(userId, body);
  }

  @Get('me/dashboard')
  @RequirePermissions(Permission.CANDIDATE_READ)
  getDashboard(@CurrentUser('sub') userId: string) {
    return this.candidatesService.getDashboardByUser(userId);
  }

  @Get('me/admit-card/:examId')
  @RequirePermissions(Permission.CANDIDATE_ADMIT_CARD)
  @ApiOperation({ summary: 'Get admit card for an exam' })
  getAdmitCard(@CurrentUser('sub') userId: string, @Param('examId') examId: string) {
    return this.candidatesService.getAdmitCard(userId, examId);
  }

  @Get(':id')
  @RequirePermissions(Permission.CANDIDATE_READ)
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.candidatesService.findOne(id, tenantId);
  }

  @Patch(':id/kyc/verify')
  @RequirePermissions(Permission.CANDIDATE_KYC_VERIFY)
  verifyKyc(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body('status') status: 'VERIFIED' | 'REJECTED',
  ) {
    return this.candidatesService.updateKyc(id, tenantId, status);
  }

  @Patch(':id/batch')
  @RequirePermissions(Permission.BATCH_MANAGE)
  @ApiOperation({ summary: 'Assign or change student class/batch' })
  setBatch(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { batchId: string | null; rollNumber?: string },
  ) {
    return this.candidatesService.setBatchEnrollment(id, tenantId, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CANDIDATE_UPDATE)
  @ApiOperation({ summary: 'Update student profile' })
  update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      registrationNumber?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
      password?: string;
    },
  ) {
    return this.candidatesService.update(id, tenantId, body);
  }

  @Delete(':id')
  @RequirePermissions(Permission.CANDIDATE_DELETE)
  @ApiOperation({ summary: 'Remove student from institute (deactivate account)' })
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.candidatesService.remove(id, tenantId);
  }
}

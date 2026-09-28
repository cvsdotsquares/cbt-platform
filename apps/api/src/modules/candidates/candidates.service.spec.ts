import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CandidatesService } from './candidates.service';

describe('CandidatesService.updateKyc', () => {
  const prisma = {
    candidate: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  const service = new CandidatesService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects verification when the student has not submitted KYC', async () => {
    prisma.candidate.findFirst.mockResolvedValue({
      id: 'candidate-1',
      tenantId: 'tenant-1',
      kycStatus: 'NOT_SUBMITTED',
    });

    await expect(service.updateKyc('candidate-1', 'tenant-1', 'VERIFIED')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.candidate.update).not.toHaveBeenCalled();
  });

  it('rejects unknown candidates before any KYC change', async () => {
    prisma.candidate.findFirst.mockResolvedValue(null);

    await expect(service.updateKyc('missing-candidate', 'tenant-1', 'VERIFIED')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.candidate.update).not.toHaveBeenCalled();
  });

  it('rejects verification when the student has not submitted KYC even for super admin', async () => {
    prisma.candidate.findFirst.mockResolvedValue({
      id: 'candidate-1',
      tenantId: 'tenant-1',
      kycStatus: 'NOT_SUBMITTED',
    });

    await expect(service.updateKyc('candidate-1', 'tenant-1', 'VERIFIED')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.candidate.update).not.toHaveBeenCalled();
  });

  it('allows verification only for pending KYC', async () => {
    prisma.candidate.findFirst.mockResolvedValue({
      id: 'candidate-1',
      tenantId: 'tenant-1',
      kycStatus: 'PENDING',
    });
    prisma.candidate.update.mockResolvedValue({
      id: 'candidate-1',
      kycStatus: 'VERIFIED',
      kycVerifiedAt: new Date('2026-09-09T00:00:00Z'),
    });

    await expect(service.updateKyc('candidate-1', 'tenant-1', 'VERIFIED')).resolves.toMatchObject({
      kycStatus: 'VERIFIED',
    });
    expect(prisma.candidate.update).toHaveBeenCalled();
  });
});

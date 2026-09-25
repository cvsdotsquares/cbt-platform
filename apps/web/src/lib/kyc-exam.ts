export function kycAllowsExam(kycStatus: string | null | undefined): boolean {
  return kycStatus === 'VERIFIED';
}

export function kycExamBlockMessage(kycStatus: string | null | undefined): string {
  if (kycStatus === 'PENDING') {
    return 'Your KYC is under review. You can take tests after an administrator verifies it.';
  }
  if (kycStatus === 'REJECTED') {
    return 'Your KYC was rejected. Upload corrected documents and wait for verification before taking a test.';
  }
  if (kycStatus === 'NOT_SUBMITTED' || !kycStatus) {
    return 'Submit your KYC and wait until it is verified before you take a test.';
  }
  return 'Your KYC must be verified before you can take a test.';
}

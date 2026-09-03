import { Role } from '../constants/enums';
import { Permission } from './permissions';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission),

  [Role.ORG_ADMIN]: [
    Permission.USER_CREATE, Permission.USER_READ, Permission.USER_UPDATE,
    Permission.USER_DELETE, Permission.USER_ASSIGN_ROLE, Permission.SESSION_MANAGE,
    Permission.MFA_MANAGE,
    Permission.TENANT_READ, Permission.TENANT_UPDATE, Permission.TENANT_BRANDING,
    Permission.TENANT_SECURITY_CONFIG,
    Permission.CANDIDATE_CREATE, Permission.CANDIDATE_READ, Permission.CANDIDATE_UPDATE,
    Permission.CANDIDATE_DELETE, Permission.CANDIDATE_KYC_VERIFY, Permission.CANDIDATE_BULK_IMPORT,
    Permission.CANDIDATE_ADMIT_CARD,
    Permission.QUESTION_CREATE, Permission.QUESTION_READ, Permission.QUESTION_UPDATE,
    Permission.QUESTION_DELETE, Permission.QUESTION_APPROVE, Permission.QUESTION_IMPORT,
    Permission.QUESTION_EXPORT, Permission.QUESTION_VERSION,
    Permission.EXAM_CREATE, Permission.EXAM_READ, Permission.EXAM_UPDATE,
    Permission.EXAM_DELETE, Permission.EXAM_PUBLISH, Permission.EXAM_SCHEDULE,
    Permission.EXAM_ASSIGN_CANDIDATES, Permission.EXAM_TEMPLATE, Permission.EXAM_VIEW_RESPONSE,
    Permission.PROCTORING_MONITOR, Permission.PROCTORING_INTERVENE, Permission.PROCTORING_TERMINATE,
    Permission.PROCTORING_VIEW_RECORDINGS, Permission.PROCTORING_MANAGE_ALERTS,
    Permission.SECURITY_VIEW_VIOLATIONS, Permission.SECURITY_CONFIGURE,
    Permission.SECURITY_IP_RESTRICT, Permission.SECURITY_GEOFENCE,
    Permission.CODING_CREATE, Permission.CODING_VIEW_SUBMISSIONS, Permission.CODING_PLAGIARISM_CHECK,
    Permission.RESULT_EVALUATE, Permission.RESULT_PUBLISH, Permission.RESULT_READ,
    Permission.RESULT_RANK, Permission.RESULT_CUTOFF, Permission.RESULT_CERTIFICATE,
    Permission.ANALYTICS_VIEW, Permission.ANALYTICS_EXPORT,
    Permission.AUDIT_READ, Permission.AUDIT_EXPORT,
    Permission.CURRICULUM_MANAGE, Permission.CURRICULUM_READ,
    Permission.BATCH_MANAGE, Permission.BATCH_READ,
    Permission.SYLLABUS_MANAGE, Permission.SYLLABUS_READ,
    Permission.MATERIAL_UPLOAD, Permission.MATERIAL_READ, Permission.MATERIAL_DELETE,
    Permission.AI_GENERATE_TEST,
    Permission.LEARNING_READ, Permission.LEARNING_MANAGE,
  ],

  [Role.EXAM_MANAGER]: [
    Permission.USER_READ,
    Permission.TENANT_READ,
    Permission.CANDIDATE_CREATE, Permission.CANDIDATE_READ, Permission.CANDIDATE_UPDATE,
    Permission.CANDIDATE_KYC_VERIFY, Permission.CANDIDATE_BULK_IMPORT, Permission.CANDIDATE_ADMIT_CARD,
    Permission.QUESTION_READ, Permission.QUESTION_EXPORT,
    Permission.EXAM_CREATE, Permission.EXAM_READ, Permission.EXAM_UPDATE,
    Permission.EXAM_DELETE, Permission.EXAM_PUBLISH, Permission.EXAM_SCHEDULE,
    Permission.EXAM_ASSIGN_CANDIDATES, Permission.EXAM_TEMPLATE, Permission.EXAM_VIEW_RESPONSE,
    Permission.PROCTORING_MONITOR, Permission.PROCTORING_INTERVENE, Permission.PROCTORING_TERMINATE,
    Permission.PROCTORING_VIEW_RECORDINGS, Permission.PROCTORING_MANAGE_ALERTS,
    Permission.SECURITY_VIEW_VIOLATIONS, Permission.SECURITY_IP_RESTRICT, Permission.SECURITY_GEOFENCE,
    Permission.CODING_VIEW_SUBMISSIONS, Permission.CODING_PLAGIARISM_CHECK,
    Permission.RESULT_EVALUATE, Permission.RESULT_PUBLISH, Permission.RESULT_READ,
    Permission.RESULT_RANK, Permission.RESULT_CUTOFF, Permission.RESULT_CERTIFICATE,
    Permission.ANALYTICS_VIEW, Permission.ANALYTICS_EXPORT,
  ],

  [Role.QUESTION_MODERATOR]: [
    Permission.USER_READ,
    Permission.TENANT_READ,
    Permission.QUESTION_CREATE, Permission.QUESTION_READ, Permission.QUESTION_UPDATE,
    Permission.QUESTION_DELETE, Permission.QUESTION_APPROVE, Permission.QUESTION_IMPORT,
    Permission.QUESTION_EXPORT, Permission.QUESTION_VERSION,
    Permission.CODING_CREATE,
    Permission.ANALYTICS_VIEW,
  ],

  [Role.PROCTOR]: [
    Permission.USER_READ,
    Permission.TENANT_READ,
    Permission.CANDIDATE_READ,
    Permission.EXAM_READ,
    Permission.PROCTORING_MONITOR, Permission.PROCTORING_INTERVENE, Permission.PROCTORING_TERMINATE,
    Permission.PROCTORING_VIEW_RECORDINGS, Permission.PROCTORING_MANAGE_ALERTS,
    Permission.SECURITY_VIEW_VIOLATIONS,
  ],

  [Role.EVALUATOR]: [
    Permission.USER_READ,
    Permission.TENANT_READ,
    Permission.CANDIDATE_READ,
    Permission.QUESTION_READ,
    Permission.EXAM_READ,
    Permission.CODING_VIEW_SUBMISSIONS,
    Permission.RESULT_EVALUATE, Permission.RESULT_READ,
  ],

  [Role.CANDIDATE]: [
    Permission.USER_READ, Permission.USER_UPDATE,
    Permission.SESSION_MANAGE, Permission.MFA_MANAGE,
    Permission.CANDIDATE_READ, Permission.CANDIDATE_UPDATE, Permission.CANDIDATE_ADMIT_CARD,
    Permission.EXAM_READ, Permission.EXAM_TAKE, Permission.EXAM_SUBMIT,
    Permission.EXAM_RESUME, Permission.EXAM_VIEW_RESPONSE,
    Permission.CODING_EXECUTE,
    Permission.RESULT_READ, Permission.RESULT_CERTIFICATE,
    Permission.LEARNING_READ,
  ],

  [Role.AUDITOR]: [
    Permission.USER_READ,
    Permission.TENANT_READ,
    Permission.CANDIDATE_READ,
    Permission.QUESTION_READ,
    Permission.EXAM_READ,
    Permission.PROCTORING_MONITOR, Permission.PROCTORING_VIEW_RECORDINGS,
    Permission.SECURITY_VIEW_VIOLATIONS,
    Permission.CODING_VIEW_SUBMISSIONS, Permission.CODING_PLAGIARISM_CHECK,
    Permission.RESULT_READ,
    Permission.ANALYTICS_VIEW, Permission.ANALYTICS_EXPORT,
    Permission.AUDIT_READ, Permission.AUDIT_EXPORT,
    Permission.CURRICULUM_READ, Permission.BATCH_READ, Permission.SYLLABUS_READ,
    Permission.MATERIAL_READ, Permission.LEARNING_READ,
  ],

  [Role.INSTITUTE_ADMIN]: [
    Permission.USER_CREATE, Permission.USER_READ, Permission.USER_UPDATE,
    Permission.USER_DELETE, Permission.USER_ASSIGN_ROLE, Permission.SESSION_MANAGE,
    Permission.MFA_MANAGE,
    Permission.TENANT_READ, Permission.TENANT_UPDATE, Permission.TENANT_BRANDING,
    Permission.TENANT_SECURITY_CONFIG,
    Permission.CANDIDATE_CREATE, Permission.CANDIDATE_READ, Permission.CANDIDATE_UPDATE,
    Permission.CANDIDATE_DELETE, Permission.CANDIDATE_BULK_IMPORT,
    Permission.QUESTION_CREATE, Permission.QUESTION_READ, Permission.QUESTION_UPDATE,
    Permission.QUESTION_DELETE, Permission.QUESTION_APPROVE, Permission.QUESTION_IMPORT,
    Permission.QUESTION_EXPORT, Permission.QUESTION_VERSION,
    Permission.EXAM_CREATE, Permission.EXAM_READ, Permission.EXAM_UPDATE,
    Permission.EXAM_DELETE, Permission.EXAM_PUBLISH, Permission.EXAM_SCHEDULE,
    Permission.EXAM_ASSIGN_CANDIDATES, Permission.EXAM_TEMPLATE, Permission.EXAM_VIEW_RESPONSE,
    Permission.RESULT_EVALUATE, Permission.RESULT_PUBLISH, Permission.RESULT_READ,
    Permission.RESULT_RANK, Permission.RESULT_CUTOFF, Permission.RESULT_CERTIFICATE,
    Permission.ANALYTICS_VIEW, Permission.ANALYTICS_EXPORT,
    Permission.AUDIT_READ,
    Permission.CURRICULUM_MANAGE, Permission.CURRICULUM_READ,
    Permission.BATCH_MANAGE, Permission.BATCH_READ,
    Permission.SYLLABUS_MANAGE, Permission.SYLLABUS_READ,
    Permission.MATERIAL_UPLOAD, Permission.MATERIAL_READ, Permission.MATERIAL_DELETE,
    Permission.AI_GENERATE_TEST,
    Permission.LEARNING_READ, Permission.LEARNING_MANAGE,
  ],

  /** Teaching portal — assigned subjects, progress, students, class tests, results. */
  [Role.TEACHER]: [
    Permission.CANDIDATE_READ, Permission.CANDIDATE_UPDATE,
    Permission.CURRICULUM_READ,
    Permission.BATCH_READ,
    Permission.SYLLABUS_MANAGE, Permission.SYLLABUS_READ,
    Permission.QUESTION_READ, Permission.QUESTION_UPDATE,
    Permission.EXAM_CREATE, Permission.EXAM_READ, Permission.EXAM_UPDATE,
    Permission.EXAM_PUBLISH, Permission.EXAM_SCHEDULE, Permission.EXAM_ASSIGN_CANDIDATES,
    Permission.EXAM_VIEW_RESPONSE,
    Permission.RESULT_READ, Permission.RESULT_EVALUATE, Permission.RESULT_PUBLISH, Permission.RESULT_RANK,
    Permission.MATERIAL_READ,
    Permission.AI_GENERATE_TEST,
    Permission.LEARNING_READ, Permission.LEARNING_MANAGE,
  ],

  [Role.STUDENT]: [
    Permission.USER_READ, Permission.USER_UPDATE,
    Permission.SESSION_MANAGE, Permission.MFA_MANAGE,
    Permission.CANDIDATE_READ, Permission.CANDIDATE_UPDATE,
    Permission.EXAM_READ, Permission.EXAM_TAKE, Permission.EXAM_SUBMIT,
    Permission.EXAM_RESUME, Permission.EXAM_VIEW_RESPONSE,
    Permission.RESULT_READ,
    Permission.CURRICULUM_READ,
    Permission.SYLLABUS_READ,
    Permission.LEARNING_READ,
    Permission.AI_GENERATE_TEST,
  ],
};

export function hasPermission(roles: Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
}

export function getPermissionsForRoles(roles: Role[]): Permission[] {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const perm of ROLE_PERMISSIONS[role] ?? []) {
      permissions.add(perm);
    }
  }
  return Array.from(permissions);
}

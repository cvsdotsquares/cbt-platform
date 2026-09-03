export enum Permission {
  // Users
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  USER_ASSIGN_ROLE = 'user:assign_role',
  SESSION_MANAGE = 'session:manage',
  MFA_MANAGE = 'mfa:manage',

  // Tenants
  TENANT_CREATE = 'tenant:create',
  TENANT_READ = 'tenant:read',
  TENANT_UPDATE = 'tenant:update',
  TENANT_DELETE = 'tenant:delete',
  TENANT_BRANDING = 'tenant:branding',
  TENANT_SECURITY_CONFIG = 'tenant:security_config',

  // Candidates
  CANDIDATE_CREATE = 'candidate:create',
  CANDIDATE_READ = 'candidate:read',
  CANDIDATE_UPDATE = 'candidate:update',
  CANDIDATE_DELETE = 'candidate:delete',
  CANDIDATE_KYC_VERIFY = 'candidate:kyc_verify',
  CANDIDATE_BULK_IMPORT = 'candidate:bulk_import',
  CANDIDATE_ADMIT_CARD = 'candidate:admit_card',

  // Questions
  QUESTION_CREATE = 'question:create',
  QUESTION_READ = 'question:read',
  QUESTION_UPDATE = 'question:update',
  QUESTION_DELETE = 'question:delete',
  QUESTION_APPROVE = 'question:approve',
  QUESTION_IMPORT = 'question:import',
  QUESTION_EXPORT = 'question:export',
  QUESTION_VERSION = 'question:version',

  // Exams
  EXAM_CREATE = 'exam:create',
  EXAM_READ = 'exam:read',
  EXAM_UPDATE = 'exam:update',
  EXAM_DELETE = 'exam:delete',
  EXAM_PUBLISH = 'exam:publish',
  EXAM_SCHEDULE = 'exam:schedule',
  EXAM_ASSIGN_CANDIDATES = 'exam:assign_candidates',
  EXAM_TEMPLATE = 'exam:template',
  EXAM_TAKE = 'exam:take',
  EXAM_SUBMIT = 'exam:submit',
  EXAM_RESUME = 'exam:resume',
  EXAM_VIEW_RESPONSE = 'exam:view_response',

  // Proctoring
  PROCTORING_MONITOR = 'proctoring:monitor',
  PROCTORING_INTERVENE = 'proctoring:intervene',
  PROCTORING_TERMINATE = 'proctoring:terminate_session',
  PROCTORING_VIEW_RECORDINGS = 'proctoring:view_recordings',
  PROCTORING_MANAGE_ALERTS = 'proctoring:manage_alerts',

  // Security
  SECURITY_VIEW_VIOLATIONS = 'security:view_violations',
  SECURITY_CONFIGURE = 'security:configure',
  SECURITY_IP_RESTRICT = 'security:ip_restrict',
  SECURITY_GEOFENCE = 'security:geofence',

  // Coding
  CODING_CREATE = 'coding:create',
  CODING_EXECUTE = 'coding:execute',
  CODING_VIEW_SUBMISSIONS = 'coding:view_submissions',
  CODING_PLAGIARISM_CHECK = 'coding:plagiarism_check',

  // Results
  RESULT_EVALUATE = 'result:evaluate',
  RESULT_PUBLISH = 'result:publish',
  RESULT_READ = 'result:read',
  RESULT_RANK = 'result:rank',
  RESULT_CUTOFF = 'result:cutoff',
  RESULT_CERTIFICATE = 'result:certificate',

  // Analytics & Audit
  ANALYTICS_VIEW = 'analytics:view',
  ANALYTICS_EXPORT = 'analytics:export',
  AUDIT_READ = 'audit:read',
  AUDIT_EXPORT = 'audit:export',

  // Curriculum & Learning
  CURRICULUM_MANAGE = 'curriculum:manage',
  CURRICULUM_READ = 'curriculum:read',
  BATCH_MANAGE = 'batch:manage',
  BATCH_READ = 'batch:read',
  SYLLABUS_MANAGE = 'syllabus:manage',
  SYLLABUS_READ = 'syllabus:read',
  MATERIAL_UPLOAD = 'material:upload',
  MATERIAL_READ = 'material:read',
  MATERIAL_DELETE = 'material:delete',
  AI_GENERATE_TEST = 'ai:generate_test',
  LEARNING_READ = 'learning:read',
  LEARNING_MANAGE = 'learning:manage',
}

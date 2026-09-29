import { Permission, ROLE_PERMISSIONS } from '@cbt/shared';

export const ROLE_PERMISSIONS_SETTINGS_KEY = 'rolePermissions';

export const CONFIGURABLE_ROLES = [
  {
    name: 'TEACHER',
    label: 'Teacher',
    description: 'What a class teacher can open, create, and change.',
  },
  {
    name: 'INSTITUTE_ADMIN',
    label: 'Institute Admin',
    description: 'What institute staff can open, create, and change.',
  },
] as const;

export const CONFIGURABLE_ROLE_NAMES = new Set<string>(CONFIGURABLE_ROLES.map((role) => role.name));

const MODULES: { key: string; label: string; cells: Record<string, string> }[] = [
  {
    key: 'students',
    label: 'Students',
    cells: {
      View: Permission.CANDIDATE_READ,
      Create: Permission.CANDIDATE_CREATE,
      Edit: Permission.CANDIDATE_UPDATE,
      Delete: Permission.CANDIDATE_DELETE,
      Invite: Permission.CANDIDATE_INVITE,
      'Verify KYC': Permission.CANDIDATE_KYC_VERIFY,
    },
  },
  {
    key: 'tests',
    label: 'Class Tests',
    cells: {
      View: Permission.EXAM_READ,
      Create: Permission.EXAM_CREATE,
      Edit: Permission.EXAM_UPDATE,
      Delete: Permission.EXAM_DELETE,
      Publish: Permission.EXAM_PUBLISH,
      Schedule: Permission.EXAM_SCHEDULE,
      Assign: Permission.EXAM_ASSIGN_CANDIDATES,
      Answers: Permission.EXAM_VIEW_RESPONSE,
    },
  },
  {
    key: 'questions',
    label: 'Questions',
    cells: {
      View: Permission.QUESTION_READ,
      Create: Permission.QUESTION_CREATE,
      Edit: Permission.QUESTION_UPDATE,
      Delete: Permission.QUESTION_DELETE,
      Approve: Permission.QUESTION_APPROVE,
    },
  },
  {
    key: 'results',
    label: 'Results',
    cells: {
      View: Permission.RESULT_READ,
      Grade: Permission.RESULT_EVALUATE,
      Publish: Permission.RESULT_PUBLISH,
      Rank: Permission.RESULT_RANK,
    },
  },
  {
    key: 'books',
    label: 'NCERT Books',
    cells: {
      View: Permission.MATERIAL_READ,
      Upload: Permission.MATERIAL_UPLOAD,
      Delete: Permission.MATERIAL_DELETE,
    },
  },
  {
    key: 'syllabus',
    label: 'Syllabus',
    cells: {
      View: Permission.CURRICULUM_READ,
      Topics: Permission.SYLLABUS_READ,
      Manage: Permission.SYLLABUS_MANAGE,
    },
  },
  {
    key: 'classes',
    label: 'Classes & Batches',
    cells: {
      View: Permission.BATCH_READ,
      Manage: Permission.BATCH_MANAGE,
    },
  },
  {
    key: 'learning',
    label: 'Teacher Home',
    cells: {
      View: Permission.LEARNING_READ,
      Manage: Permission.LEARNING_MANAGE,
    },
  },
  {
    key: 'ai',
    label: 'Create Class Test',
    cells: {
      Generate: Permission.AI_GENERATE_TEST,
    },
  },
  {
    key: 'monitoring',
    label: 'Live Monitoring',
    cells: {
      Monitor: Permission.PROCTORING_MONITOR,
      Violations: Permission.SECURITY_VIEW_VIOLATIONS,
    },
  },
  {
    key: 'analytics',
    label: 'Analytics',
    cells: {
      View: Permission.ANALYTICS_VIEW,
    },
  },
];

export const PERMISSION_COLUMNS = [
  'View',
  'Create',
  'Edit',
  'Delete',
  'Invite',
  'Verify KYC',
  'Publish',
  'Schedule',
  'Assign',
  'Answers',
  'Approve',
  'Grade',
  'Rank',
  'Upload',
  'Topics',
  'Manage',
  'Generate',
  'Monitor',
  'Violations',
];

export const PERMISSION_MODULES = MODULES;

export const CATALOG_CODES = new Set<string>(
  MODULES.flatMap((module) => Object.values(module.cells)),
);

export function defaultCatalogCodes(roleName: string): string[] {
  const base = new Set(ROLE_PERMISSIONS[roleName.toUpperCase() as keyof typeof ROLE_PERMISSIONS] ?? []);
  return [...base].filter((code) => CATALOG_CODES.has(code)).sort();
}

export function grantedCodes(roleName: string, overrides: Record<string, string[]>): string[] {
  const key = roleName.toUpperCase();
  const base = new Set<string>(ROLE_PERMISSIONS[key as keyof typeof ROLE_PERMISSIONS] ?? []);
  if (!(key in overrides)) return [...base].sort();
  const saved = new Set(overrides[key]);
  const granted = new Set<string>();
  for (const code of base) {
    if (!CATALOG_CODES.has(code)) granted.add(code);
  }
  for (const code of saved) {
    if (CATALOG_CODES.has(code)) granted.add(code);
  }
  return [...granted].sort();
}

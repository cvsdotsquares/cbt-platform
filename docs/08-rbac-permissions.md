# 8. RBAC Permissions Matrix

## Roles Overview

| Role | Scope | Description |
|------|-------|-------------|
| **SUPER_ADMIN** | Global | Platform-wide administration, tenant management |
| **ORG_ADMIN** | Tenant | Organization settings, user management, billing |
| **EXAM_MANAGER** | Tenant | Exam creation, scheduling, candidate assignment |
| **QUESTION_MODERATOR** | Tenant | Question bank CRUD, approval workflow |
| **PROCTOR** | Exam | Live monitoring, violation management |
| **EVALUATOR** | Exam | Manual evaluation of subjective answers |
| **CANDIDATE** | Self | Take exams, view results, manage profile |
| **AUDITOR** | Tenant | Read-only access to audit logs, compliance reports |

## Permission Format

Permissions follow the pattern: `{module}:{action}`

Examples: `exam:create`, `question:approve`, `proctoring:intervene`

## Complete Permissions Matrix

### Authentication & Users

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `user:create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔸 | ✅ |
| `user:update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔸 | ❌ |
| `user:delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user:assign_role` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `session:manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔸 | ❌ |
| `mfa:manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔸 | ❌ |

🔸 = Own resource only

### Tenant Management

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `tenant:create` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tenant:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `tenant:update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tenant:delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tenant:branding` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tenant:security_config` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Candidate Management

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `candidate:create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `candidate:read` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | 🔸 | ✅ |
| `candidate:update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🔸 | ❌ |
| `candidate:delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `candidate:kyc_verify` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `candidate:bulk_import` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `candidate:admit_card` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🔸 | ❌ |

### Question Bank

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `question:create` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `question:read` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `question:update` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `question:delete` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `question:approve` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `question:import` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `question:export` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `question:version` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Exam Management

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `exam:create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `exam:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔸 | ✅ |
| `exam:update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `exam:delete` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `exam:publish` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `exam:schedule` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `exam:assign_candidates` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `exam:template` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Exam Engine (Taking Exams)

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `exam:take` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `exam:submit` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `exam:resume` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `exam:view_response` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🔸 | ❌ |

### Proctoring & Monitoring

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `proctoring:monitor` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| `proctoring:intervene` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `proctoring:terminate_session` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `proctoring:view_recordings` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| `proctoring:manage_alerts` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |

### Security

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `security:view_violations` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| `security:configure` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `security:ip_restrict` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `security:geofence` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Coding Assessment

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `coding:create` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `coding:execute` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `coding:view_submissions` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | 🔸 | ✅ |
| `coding:plagiarism_check` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |

### Results & Evaluation

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `result:evaluate` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `result:publish` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `result:read` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | 🔸 | ✅ |
| `result:rank` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `result:cutoff` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `result:certificate` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🔸 | ❌ |

### Analytics & Audit

| Permission | SUPER_ADMIN | ORG_ADMIN | EXAM_MANAGER | QUESTION_MODERATOR | PROCTOR | EVALUATOR | CANDIDATE | AUDITOR |
|------------|:-----------:|:---------:|:------------:|:------------------:|:-------:|:---------:|:---------:|:-------:|
| `analytics:view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `analytics:export` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `audit:read` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `audit:export` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

## Implementation

```typescript
// packages/shared/src/rbac/permissions.ts
export enum Permission {
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  // ... all permissions
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission), // All permissions
  [Role.ORG_ADMIN]: [ /* subset */ ],
  [Role.EXAM_MANAGER]: [ /* subset */ ],
  // ...
};
```

```typescript
// NestJS Guard usage
@RequirePermissions(Permission.EXAM_CREATE)
@Post()
createExam(@Body() dto: CreateExamDto) { ... }
```

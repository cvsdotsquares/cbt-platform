# 5. Prisma Models

Complete database schema is defined in `apps/api/prisma/schema.prisma`.

## Model Summary

| Model | Table | Description |
|-------|-------|-------------|
| `Tenant` | tenants | Multi-tenant organizations |
| `User` | users | Platform users (all roles) |
| `Role` | roles | RBAC roles (8 system roles) |
| `Permission` | permissions | Granular permissions (60+) |
| `UserRole` | user_roles | User-role assignments |
| `RolePermission` | role_permissions | Role-permission mappings |
| `Session` | sessions | Auth sessions with refresh tokens |
| `LoginHistory` | login_history | Login attempt audit trail |
| `Candidate` | candidates | Exam candidate profiles |
| `CandidateDocument` | candidate_documents | KYC/document uploads |
| `Topic` | topics | Question topic hierarchy |
| `Question` | questions | Question bank entries |
| `QuestionVersion` | question_versions | Version-controlled question content |
| `QuestionTag` | question_tags | Question tagging |
| `Exam` | exams | Exam definitions |
| `ExamSection` | exam_sections | Exam sections with timing |
| `ExamQuestion` | exam_questions | Questions assigned to exams |
| `ExamRegistration` | exam_registrations | Candidate exam registrations |
| `ExamSession` | exam_sessions | Active exam sessions |
| `SessionResponse` | session_responses | Candidate answers |
| `ProctoringEvent` | proctoring_events | AI proctoring events |
| `SecurityViolation` | security_violations | Browser security violations |
| `ExamResult` | exam_results | Evaluation results |
| `SectionResult` | section_results | Per-section scores |
| `CodingSubmission` | coding_submissions | Code assessment submissions |
| `AuditLog` | audit_logs | Immutable audit trail |

## Key Relationships

```
Tenant 1──∞ User 1──∞ UserRole ∞──1 Role ∞──∞ Permission
User 1──1 Candidate 1──∞ ExamRegistration ∞──1 Exam
Exam 1──∞ ExamSection 1──∞ ExamQuestion ∞──1 Question
ExamRegistration 1──∞ ExamSession 1──∞ SessionResponse
ExamSession 1──∞ ProctoringEvent, SecurityViolation
ExamSession 1──1 ExamResult 1──∞ SectionResult
Question 1──∞ QuestionVersion
```

## Enums

- **UserStatus:** ACTIVE, INACTIVE, SUSPENDED, PENDING_VERIFICATION
- **QuestionType:** MCQ, MSQ, NUMERICAL, SUBJECTIVE, CODING, CASE_STUDY, AUDIO, VIDEO
- **ExamType:** GOVERNMENT, UNIVERSITY, RECRUITMENT, CERTIFICATION, ONLINE_ASSESSMENT, CODING
- **SessionStatus:** WAITING, IDENTITY_VERIFICATION, IN_PROGRESS, PAUSED, SUBMITTED, AUTO_SUBMITTED, TERMINATED, EXPIRED
- **ProctoringEventType:** 17 violation types
- **ViolationSeverity:** LOW, MEDIUM, HIGH, CRITICAL
- **EvaluationStatus:** PENDING, AUTO_EVALUATED, MANUAL_REVIEW, EVALUATED, PUBLISHED

## Usage

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Seed initial data (roles, permissions, admin user)
pnpm db:seed

# Open Prisma Studio
pnpm --filter @cbt/api prisma:studio
```

## Seed Data

The seed script creates:
- Default tenant (`slug: default`)
- All 8 roles with permission mappings
- Super Admin: `admin@cbt-platform.com` / `Admin@123`
- Test Candidate: `candidate@example.com` / `Candidate@123`
- Sample question and topic

# 6. API Structure

## Base URL

```
Production:  https://api.{tenant-domain}/v1
Development: http://localhost:4000/api/v1
WebSocket:   wss://api.{tenant-domain}/ws
```

## Authentication Headers

```http
Authorization: Bearer <access_token>
X-Tenant-ID: <tenant_slug>
X-Device-Fingerprint: <fingerprint_hash>
X-Request-ID: <uuid>
```

## REST API Endpoints

### Authentication (`/auth`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/register` | Register new user | Public |
| POST | `/auth/login` | Login with email/password | Public |
| POST | `/auth/mfa/verify` | Verify MFA TOTP code | MFA Token |
| POST | `/auth/mfa/setup` | Setup MFA (generate QR) | Bearer |
| POST | `/auth/mfa/confirm` | Confirm MFA setup | Bearer |
| POST | `/auth/refresh` | Refresh access token | Refresh Token |
| POST | `/auth/logout` | Logout (invalidate session) | Bearer |
| POST | `/auth/forgot-password` | Request password reset | Public |
| POST | `/auth/reset-password` | Reset password with token | Reset Token |
| POST | `/auth/verify-otp` | Verify email/phone OTP | Public |
| GET | `/auth/sessions` | List active sessions | Bearer |
| DELETE | `/auth/sessions/:id` | Revoke specific session | Bearer |
| GET | `/auth/login-history` | Login history | Bearer |

### Tenants (`/tenants`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/tenants` | Create tenant | `tenant:create` |
| GET | `/tenants` | List tenants | `tenant:read` |
| GET | `/tenants/:id` | Get tenant details | `tenant:read` |
| PATCH | `/tenants/:id` | Update tenant | `tenant:update` |
| DELETE | `/tenants/:id` | Delete tenant | `tenant:delete` |
| PATCH | `/tenants/:id/branding` | Update branding | `tenant:branding` |
| PATCH | `/tenants/:id/security` | Update security config | `tenant:security_config` |

### Users (`/users`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/users` | Create user | `user:create` |
| GET | `/users` | List users (paginated) | `user:read` |
| GET | `/users/:id` | Get user details | `user:read` |
| PATCH | `/users/:id` | Update user | `user:update` |
| DELETE | `/users/:id` | Deactivate user | `user:delete` |
| POST | `/users/:id/roles` | Assign role | `user:assign_role` |
| DELETE | `/users/:id/roles/:roleId` | Remove role | `user:assign_role` |

### Candidates (`/candidates`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/candidates` | Register candidate | `candidate:create` |
| GET | `/candidates` | List candidates | `candidate:read` |
| GET | `/candidates/:id` | Get candidate profile | `candidate:read` |
| PATCH | `/candidates/:id` | Update profile | `candidate:update` |
| POST | `/candidates/:id/documents` | Upload document | `candidate:update` |
| POST | `/candidates/:id/kyc` | Submit KYC | `candidate:update` |
| POST | `/candidates/:id/kyc/verify` | Verify KYC | `candidate:kyc_verify` |
| POST | `/candidates/bulk-import` | Bulk import | `candidate:bulk_import` |
| GET | `/candidates/:id/admit-card/:examId` | Generate admit card | `candidate:admit_card` |
| GET | `/candidates/me/dashboard` | Candidate dashboard | `candidate:read` |

### Questions (`/questions`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/questions` | Create question | `question:create` |
| GET | `/questions` | List/search questions | `question:read` |
| GET | `/questions/:id` | Get question details | `question:read` |
| PATCH | `/questions/:id` | Update question | `question:update` |
| DELETE | `/questions/:id` | Delete question | `question:delete` |
| POST | `/questions/:id/versions` | Create new version | `question:version` |
| POST | `/questions/:id/approve` | Approve question | `question:approve` |
| POST | `/questions/import` | Bulk import | `question:import` |
| GET | `/questions/export` | Export questions | `question:export` |
| GET | `/questions/topics` | List topics | `question:read` |
| POST | `/questions/topics` | Create topic | `question:create` |

### Exams (`/exams`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/exams` | Create exam | `exam:create` |
| GET | `/exams` | List exams | `exam:read` |
| GET | `/exams/:id` | Get exam details | `exam:read` |
| PATCH | `/exams/:id` | Update exam | `exam:update` |
| DELETE | `/exams/:id` | Delete exam | `exam:delete` |
| POST | `/exams/:id/publish` | Publish exam | `exam:publish` |
| POST | `/exams/:id/sections` | Add section | `exam:update` |
| POST | `/exams/:id/questions` | Add questions to exam | `exam:update` |
| POST | `/exams/:id/candidates` | Assign candidates | `exam:assign_candidates` |
| GET | `/exams/templates` | List templates | `exam:template` |
| POST | `/exams/templates` | Create template | `exam:template` |

### Exam Engine (`/exam-sessions`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/exam-sessions/start` | Start exam session | `exam:take` |
| GET | `/exam-sessions/:id` | Get session state | `exam:take` |
| POST | `/exam-sessions/:id/responses` | Save answer | `exam:take` |
| PATCH | `/exam-sessions/:id/responses/:qId` | Update answer | `exam:take` |
| POST | `/exam-sessions/:id/mark-review` | Mark for review | `exam:take` |
| POST | `/exam-sessions/:id/submit` | Submit exam | `exam:submit` |
| POST | `/exam-sessions/:id/heartbeat` | Session heartbeat | `exam:take` |
| GET | `/exam-sessions/:id/sync` | Sync offline data | `exam:resume` |

### Proctoring (`/proctoring`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/proctoring/verify-identity` | Pre-exam face verification | `exam:take` |
| POST | `/proctoring/events` | Report proctoring event | `exam:take` |
| GET | `/proctoring/sessions/:examId/live` | Live monitoring data | `proctoring:monitor` |
| POST | `/proctoring/sessions/:id/intervene` | Proctor intervention | `proctoring:intervene` |
| POST | `/proctoring/sessions/:id/terminate` | Terminate session | `proctoring:terminate_session` |
| GET | `/proctoring/sessions/:id/recordings` | View recordings | `proctoring:view_recordings` |

### Coding (`/coding`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/coding/execute` | Execute code | `coding:execute` |
| POST | `/coding/submit` | Submit solution | `coding:execute` |
| GET | `/coding/submissions/:id` | Get submission result | `coding:view_submissions` |
| POST | `/coding/plagiarism-check` | Run plagiarism check | `coding:plagiarism_check` |

### Results (`/results`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/results/exam/:examId` | List exam results | `result:read` |
| GET | `/results/candidate/:candidateId` | Candidate results | `result:read` |
| POST | `/results/evaluate/:sessionId` | Trigger evaluation | `result:evaluate` |
| POST | `/results/publish/:examId` | Publish results | `result:publish` |
| POST | `/results/rank/:examId` | Calculate ranks | `result:rank` |
| PATCH | `/results/cutoff/:examId` | Set cutoff | `result:cutoff` |
| GET | `/results/:id/scorecard` | Download scorecard | `result:read` |
| GET | `/results/:id/certificate` | Download certificate | `result:certificate` |

### Analytics (`/analytics`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/analytics/exam/:examId` | Exam analytics | `analytics:view` |
| GET | `/analytics/candidate/:id` | Candidate analytics | `analytics:view` |
| GET | `/analytics/questions` | Question analytics | `analytics:view` |
| GET | `/analytics/organization` | Org analytics | `analytics:view` |
| GET | `/analytics/proctoring/:examId` | Proctoring analytics | `analytics:view` |
| GET | `/analytics/export/:type` | Export report | `analytics:export` |

### Audit (`/audit`)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/audit/logs` | List audit logs | `audit:read` |
| GET | `/audit/logs/:id` | Get log detail | `audit:read` |
| GET | `/audit/export` | Export audit logs | `audit:export` |

## Request/Response Schemas

### Standard Response Envelope

```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  timestamp: string;
  requestId: string;
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ValidationError[];
  };
  timestamp: string;
  requestId: string;
}
```

### Login Request/Response

```typescript
// POST /auth/login
interface LoginRequest {
  email: string;
  password: string;
  deviceFingerprint: string;
  tenantId?: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
    mfaEnabled: boolean;
  };
  mfaRequired?: boolean;
  mfaToken?: string;
}
```

### Create Exam Request

```typescript
interface CreateExamRequest {
  title: string;
  code: string;
  type: 'GOVERNMENT' | 'UNIVERSITY' | 'RECRUITMENT' | 'CERTIFICATION' | 'CODING';
  startTime: string; // ISO8601
  endTime: string;
  timezone: string;
  settings: {
    durationMinutes: number;
    passingScore: number;
    negativeMarking: boolean;
    negativeMarkingRatio: number;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    showResultImmediately: boolean;
    allowReview: boolean;
    maxAttempts: number;
    languages: string[];
  };
  securityPolicy: ExamSecurityPolicy;
  sections: CreateExamSection[];
}
```

### Save Answer Request

```typescript
interface SaveAnswerRequest {
  questionId: string;
  answer: string | string[] | number | CodeAnswer;
  timeSpentSeconds: number;
  markedForReview?: boolean;
}

interface CodeAnswer {
  language: 'java' | 'python' | 'javascript' | 'cpp' | 'csharp' | 'go';
  sourceCode: string;
}
```

## Validation Rules

```typescript
// Global validation pipe configuration
{
  whitelist: true,           // Strip unknown properties
  forbidNonWhitelisted: true, // Reject unknown properties
  transform: true,            // Auto-transform types
  transformOptions: {
    enableImplicitConversion: true,
  },
}

// Example DTO validations
class CreateExamDto {
  @IsString() @MinLength(3) @MaxLength(200)
  title: string;

  @IsString() @Matches(/^[A-Z0-9-]+$/)
  code: string;

  @IsEnum(ExamType)
  type: ExamType;

  @IsISO8601()
  startTime: string;

  @IsISO8601() @Validate(IsAfterStartTime)
  endTime: string;

  @IsObject() @ValidateNested()
  @Type(() => ExamSettingsDto)
  settings: ExamSettingsDto;
}
```

## API Versioning

- URL-based versioning: `/api/v1/...`
- Breaking changes require new version
- Deprecation headers: `Sunset: Sat, 01 Jan 2027 00:00:00 GMT`
- Minimum 6-month deprecation period

## Pagination

```http
GET /api/v1/questions?page=1&limit=20&sort=createdAt:desc&filter[difficulty]=HARD&filter[type]=MCQ
```

```typescript
interface PaginationQuery {
  page?: number;    // Default: 1
  limit?: number;   // Default: 20, Max: 100
  sort?: string;    // field:direction
  filter?: Record<string, string>;
  search?: string;  // Full-text search
}
```

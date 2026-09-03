# 4. Database Schema

## Entity Relationship Diagram

```mermaid
erDiagram
    TENANT ||--o{ USER : has
    TENANT ||--o{ EXAM : owns
    TENANT ||--o{ QUESTION : owns
    TENANT {
        uuid id PK
        string name
        string slug UK
        string domain UK
        json branding
        enum isolation_mode
        json security_config
        timestamp created_at
    }

    USER ||--o{ USER_ROLE : has
    USER ||--o{ SESSION : has
    USER ||--o{ LOGIN_HISTORY : has
    USER {
        uuid id PK
        uuid tenant_id FK
        string email UK
        string password_hash
        string first_name
        string last_name
        boolean mfa_enabled
        string mfa_secret
        enum status
        timestamp last_login_at
    }

    ROLE ||--o{ USER_ROLE : assigned
    ROLE ||--o{ ROLE_PERMISSION : has
    ROLE {
        uuid id PK
        string name UK
        string description
        enum scope
    }

    PERMISSION {
        uuid id PK
        string code UK
        string module
        string action
    }

    CANDIDATE ||--|| USER : extends
    CANDIDATE ||--o{ CANDIDATE_DOCUMENT : has
    CANDIDATE ||--o{ EXAM_REGISTRATION : registers
    CANDIDATE {
        uuid id PK
        uuid user_id FK
        string registration_number UK
        string aadhaar_hash
        enum kyc_status
        json profile_data
        string photo_url
    }

    QUESTION ||--o{ QUESTION_VERSION : versions
    QUESTION ||--o{ QUESTION_TAG : tagged
    QUESTION ||--o{ EXAM_QUESTION : used_in
    QUESTION {
        uuid id PK
        uuid tenant_id FK
        enum type
        enum difficulty
        uuid topic_id FK
        uuid current_version_id FK
        enum status
        uuid created_by FK
    }

    QUESTION_VERSION {
        uuid id PK
        uuid question_id FK
        int version_number
        json content
        json options
        json correct_answer
        json media_refs
        int marks
        int negative_marks
        uuid approved_by FK
        timestamp approved_at
    }

    EXAM ||--o{ EXAM_SECTION : contains
    EXAM ||--o{ EXAM_REGISTRATION : has
    EXAM ||--o{ EXAM_SESSION : generates
    EXAM {
        uuid id PK
        uuid tenant_id FK
        string title
        string code UK
        enum type
        enum status
        timestamp start_time
        timestamp end_time
        string timezone
        json settings
        json security_policy
        uuid created_by FK
    }

    EXAM_SECTION ||--o{ EXAM_QUESTION : contains
    EXAM_SECTION {
        uuid id PK
        uuid exam_id FK
        string name
        int order_index
        int duration_minutes
        json instructions
        boolean negative_marking
    }

    EXAM_SESSION ||--o{ SESSION_RESPONSE : has
    EXAM_SESSION ||--o{ PROCTORING_EVENT : monitored
    EXAM_SESSION ||--o{ SECURITY_VIOLATION : tracks
    EXAM_SESSION {
        uuid id PK
        uuid exam_id FK
        uuid candidate_id FK
        uuid registration_id FK
        enum status
        timestamp started_at
        timestamp submitted_at
        int time_remaining_seconds
        json question_order
        float risk_score
        string ip_address
        string device_fingerprint
    }

    SESSION_RESPONSE {
        uuid id PK
        uuid session_id FK
        uuid question_id FK
        json answer
        boolean marked_for_review
        int time_spent_seconds
        timestamp answered_at
        timestamp updated_at
    }

    PROCTORING_EVENT {
        uuid id PK
        uuid session_id FK
        enum event_type
        float confidence
        enum severity
        json metadata
        string snapshot_url
        timestamp occurred_at
    }

    EXAM_RESULT ||--o{ SECTION_RESULT : contains
    EXAM_RESULT {
        uuid id PK
        uuid session_id FK
        uuid candidate_id FK
        uuid exam_id FK
        float total_score
        float percentage
        int rank
        float percentile
        enum evaluation_status
        boolean published
        timestamp published_at
    }

    AUDIT_LOG {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        string action
        string resource_type
        uuid resource_id
        json old_value
        json new_value
        string ip_address
        string user_agent
        timestamp created_at
    }
```

## Indexing Strategy

### Primary Indexes (B-tree)

```sql
-- High-frequency lookup paths
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_candidates_registration ON candidates(registration_number);
CREATE INDEX idx_exam_sessions_active ON exam_sessions(exam_id, status) WHERE status = 'IN_PROGRESS';
CREATE INDEX idx_session_responses_session ON session_responses(session_id, question_id);
CREATE INDEX idx_proctoring_events_session_time ON proctoring_events(session_id, occurred_at DESC);
CREATE INDEX idx_audit_logs_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_exam_registrations_exam ON exam_registrations(exam_id, candidate_id);
CREATE INDEX idx_questions_tenant_type_status ON questions(tenant_id, type, status);
```

### Composite Indexes

```sql
-- Multi-column for common query patterns
CREATE INDEX idx_exam_sessions_candidate_exam ON exam_sessions(candidate_id, exam_id, status);
CREATE INDEX idx_results_exam_rank ON exam_results(exam_id, rank) WHERE published = true;
CREATE INDEX idx_login_history_user_time ON login_history(user_id, created_at DESC);
```

### Full-Text Search

```sql
-- Question bank search
CREATE INDEX idx_questions_fts ON questions 
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

-- Audit log search
CREATE INDEX idx_audit_fts ON audit_logs 
  USING gin(to_tsvector('english', action || ' ' || resource_type));
```

### Partial Indexes

```sql
-- Active sessions only (hot data)
CREATE INDEX idx_active_sessions ON exam_sessions(exam_id, candidate_id) 
  WHERE status IN ('IN_PROGRESS', 'PAUSED');

-- Pending evaluations
CREATE INDEX idx_pending_evaluations ON exam_results(exam_id) 
  WHERE evaluation_status = 'PENDING';
```

## Partitioning Strategy

### Time-Based Partitioning

```sql
-- Proctoring events: partition by month (high volume)
CREATE TABLE proctoring_events (
    id UUID NOT NULL,
    session_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    -- ... other columns
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE proctoring_events_2026_06 PARTITION OF proctoring_events
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Audit logs: partition by quarter
CREATE TABLE audit_logs (
    id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    -- ... other columns
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Session responses: partition by exam_id hash (exam-day sharding)
CREATE TABLE session_responses (
    id UUID NOT NULL,
    session_id UUID NOT NULL,
    exam_id UUID NOT NULL,
    -- ... other columns
    PRIMARY KEY (id, exam_id)
) PARTITION BY HASH (exam_id);
```

### Partition Management

- Automated partition creation via pg_partman extension
- Retention: proctoring events 90 days, audit logs 7 years
- Archive to S3 via logical replication + AWS DMS

## Backup Strategy

| Component | Method | Frequency | Retention |
|-----------|--------|-----------|-----------|
| PostgreSQL | RDS automated snapshots | Daily | 35 days |
| PostgreSQL | Point-in-time recovery | Continuous (WAL) | 35 days |
| PostgreSQL | Cross-region snapshot copy | Daily | 90 days |
| Redis | RDB snapshots + AOF | Hourly RDB, continuous AOF | 7 days |
| S3 Documents | Versioning + Cross-region replication | Continuous | Per tenant policy |
| Application state | Velero K8s backup | Daily | 30 days |

### Recovery Procedures

1. **RPO < 1 min:** WAL streaming to standby replica
2. **RTO < 15 min:** Automated failover to read replica (RDS Multi-AZ)
3. **Disaster recovery:** Cross-region restore from snapshot (< 1 hour)
4. **Exam-day protection:** Pre-exam snapshot + read replica promotion playbook

## Connection Pooling

```
Application → PgBouncer (transaction mode) → PostgreSQL
  - Pool size: 100 per API pod
  - Max connections: 5000 (with 50 API pods)
  - Read replicas: 3 (round-robin via Prisma read replica extension)
```

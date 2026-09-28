# 11. WebSocket Events

## Connection

```typescript
// Client connection
const socket = io('wss://api.cbt-platform.com/ws', {
  auth: {
    token: accessToken,
    tenantId: 'org-slug',
    deviceFingerprint: fingerprint,
  },
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});
```

## Namespaces

| Namespace | Purpose | Auth Required |
|-----------|---------|---------------|
| `/exam` | Exam session real-time communication | Candidate |
| `/proctoring` | Proctoring events and monitoring | Candidate + Proctor |
| `/monitoring` | Live exam monitoring dashboard | Proctor, Exam Manager |
| `/notifications` | System notifications | All authenticated |

## Event Catalog

### Exam Namespace (`/exam`)

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `exam:join` | `{ sessionId: string }` | Join exam session room |
| `exam:heartbeat` | `{ sessionId: string, timestamp: string }` | Keep session alive (every 10s) |
| `exam:save-answer` | `SaveAnswerPayload` | Auto-save answer |
| `exam:mark-review` | `{ sessionId, questionId, marked: boolean }` | Toggle mark for review |
| `exam:navigate` | `{ sessionId, questionId, direction }` | Question navigation event |
| `exam:submit` | `{ sessionId: string }` | Submit exam |
| `exam:sync-offline` | `{ sessionId, responses: Response[] }` | Sync offline saved data |
| `exam:section-complete` | `{ sessionId, sectionId }` | Section timer expired |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `exam:joined` | `{ sessionId, exam, questions, timeRemaining }` | Session joined confirmation |
| `exam:answer-saved` | `{ questionId, savedAt }` | Answer save confirmation |
| `exam:time-warning` | `{ minutesRemaining: number }` | Time warning (15, 5, 1 min) |
| `exam:time-up` | `{ sessionId }` | Auto-submit triggered |
| `exam:section-change` | `{ sectionId, sectionName, duration }` | Section transition |
| `exam:submitted` | `{ sessionId, submittedAt }` | Submission confirmed |
| `exam:paused` | `{ reason, message }` | Exam paused by proctor |
| `exam:resumed` | `{ timeRemaining }` | Exam resumed |
| `exam:terminated` | `{ reason, message }` | Session terminated |
| `exam:error` | `{ code, message }` | Error notification |

```typescript
interface SaveAnswerPayload {
  sessionId: string;
  questionId: string;
  answer: string | string[] | number | CodeAnswer;
  timeSpentSeconds: number;
  markedForReview?: boolean;
  clientTimestamp: string;
}
```

### Proctoring Namespace (`/proctoring`)

#### Client → Server (Candidate)

| Event | Payload | Description |
|-------|---------|-------------|
| `proctoring:frame` | `ProctoringFramePayload` | Send analysis frame |
| `proctoring:snapshot` | `{ sessionId, imageBase64 }` | Full resolution snapshot |
| `proctoring:audio-chunk` | `{ sessionId, audioBase64 }` | Audio analysis chunk |
| `proctoring:browser-event` | `BrowserEventPayload` | Browser security event |
| `proctoring:verify-identity` | `{ sessionId, imageBase64 }` | Pre-exam identity check |

#### Server → Client (Candidate)

| Event | Payload | Description |
|-------|---------|-------------|
| `proctoring:status` | `{ riskScore, violations[], warnings[] }` | Current proctoring status |
| `proctoring:warning` | `{ type, message, severity }` | Warning to candidate |
| `proctoring:identity-verified` | `{ verified, confidence }` | Identity check result |
| `proctoring:intervention` | `{ type, message, fromProctor }` | Proctor intervention message |

#### Server → Client (Proctor Dashboard)

| Event | Payload | Description |
|-------|---------|-------------|
| `proctoring:violation` | `ViolationPayload` | New violation detected |
| `proctoring:risk-update` | `{ sessionId, candidateId, riskScore }` | Risk score update |
| `proctoring:candidate-status` | `{ sessionId, status, lastActivity }` | Candidate status change |
| `proctoring:alert` | `AlertPayload` | High-priority alert |

```typescript
interface ProctoringFramePayload {
  sessionId: string;
  thumbnail: string;        // Base64 JPEG (low res)
  timestamp: string;
  metadata: {
    tabVisible: boolean;
    fullscreen: boolean;
    focused: boolean;
    screenCount: number;
    windowSize: { width: number; height: number };
  };
}

interface BrowserEventPayload {
  sessionId: string;
  type: 'TAB_SWITCH' | 'WINDOW_BLUR' | 'COPY_ATTEMPT' | 'PASTE_ATTEMPT' |
        'RIGHT_CLICK' | 'DEVTOOLS' | 'PRINT_ATTEMPT' | 'SCREEN_CAPTURE' |
        'FULLSCREEN_EXIT' | 'KEYBOARD_SHORTCUT';
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface ViolationPayload {
  sessionId: string;
  candidateId: string;
  candidateName: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  riskScore: number;
  snapshotUrl?: string;
  timestamp: string;
}

interface AlertPayload {
  id: string;
  sessionId: string;
  candidateId: string;
  type: string;
  severity: 'HIGH' | 'CRITICAL';
  message: string;
  riskScore: number;
  timestamp: string;
  acknowledged: boolean;
}
```

### Monitoring Namespace (`/monitoring`)

#### Client → Server (Proctor/Admin)

| Event | Payload | Description |
|-------|---------|-------------|
| `monitoring:join-exam` | `{ examId: string }` | Join exam monitoring room |
| `monitoring:leave-exam` | `{ examId: string }` | Leave monitoring room |
| `monitoring:acknowledge-alert` | `{ alertId: string }` | Acknowledge alert |
| `monitoring:intervene` | `InterventionPayload` | Proctor intervention |
| `monitoring:filter` | `{ examId, filters }` | Apply dashboard filters |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `monitoring:exam-stats` | `ExamStatsPayload` | Real-time exam statistics |
| `monitoring:candidate-update` | `CandidateStatusPayload` | Candidate status update |
| `monitoring:submission` | `{ sessionId, candidateId, submittedAt }` | New submission |
| `monitoring:network-status` | `{ examId, healthy, latency }` | Network health update |

```typescript
interface ExamStatsPayload {
  examId: string;
  totalRegistered: number;
  activeNow: number;
  submitted: number;
  violations: number;
  averageRiskScore: number;
  alerts: number;
  networkHealthy: boolean;
}

interface CandidateStatusPayload {
  sessionId: string;
  candidateId: string;
  candidateName: string;
  registrationNumber: string;
  status: 'WAITING' | 'IN_PROGRESS' | 'PAUSED' | 'SUBMITTED' | 'TERMINATED';
  riskScore: number;
  violations: number;
  timeRemaining: number;
  currentQuestion: number;
  totalQuestions: number;
  lastActivity: string;
  networkStatus: 'GOOD' | 'DEGRADED' | 'POOR' | 'DISCONNECTED';
}

interface InterventionPayload {
  sessionId: string;
  type: 'WARNING' | 'PAUSE' | 'RESUME' | 'TERMINATE' | 'MESSAGE';
  message?: string;
}
```

### Notifications Namespace (`/notifications`)

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `notification:new` | S→C | `{ id, type, title, message, data }` | New notification |
| `notification:read` | C→S | `{ notificationId }` | Mark as read |
| `notification:count` | S→C | `{ unread: number }` | Unread count update |

## Room Structure

```
tenant:{tenantId}:exam:{examId}           → All participants in exam
tenant:{tenantId}:session:{sessionId}     → Individual exam session
tenant:{tenantId}:monitoring:{examId}     → Proctor monitoring dashboard
tenant:{tenantId}:proctoring:{sessionId}  → Proctoring events for session
user:{userId}                             → Personal notifications
```

## Connection Management

```typescript
// Server-side room management
@WebSocketGateway({ namespace: '/exam' })
export class ExamGateway {
  @SubscribeMessage('exam:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const session = await this.validateSession(client, data.sessionId);
    
    // Join session room
    client.join(`tenant:${session.tenantId}:session:${data.sessionId}`);
    client.join(`tenant:${session.tenantId}:exam:${session.examId}`);
    
    // Notify monitoring dashboard
    this.server
      .to(`tenant:${session.tenantId}:monitoring:${session.examId}`)
      .emit('monitoring:candidate-update', { /* status */ });
    
    return { event: 'exam:joined', data: session };
  }
}
```

## Scalability

- **Redis Adapter:** Socket.IO uses Redis pub/sub for multi-pod event broadcasting
- **Room sharding:** Large exams (>10K candidates) shard monitoring rooms
- **Event batching:** Proctoring frames batched server-side before AI analysis
- **Backpressure:** Client-side frame rate throttled when server queue > 1000

## Error Handling

```typescript
// Standard error event
interface WsError {
  code: string;
  message: string;
  retryable: boolean;
}

// Error codes
const WS_ERROR_CODES = {
  AUTH_FAILED: 'Authentication failed',
  SESSION_NOT_FOUND: 'Exam session not found',
  SESSION_EXPIRED: 'Exam session has expired',
  PERMISSION_DENIED: 'Insufficient permissions',
  RATE_LIMITED: 'Too many events, slow down',
  EXAM_NOT_ACTIVE: 'Exam is not currently active',
  CONNECTION_LOST: 'Connection lost, attempting reconnect',
};
```

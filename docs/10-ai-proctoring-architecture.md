# 10. AI Proctoring Architecture

## System Overview

```mermaid
flowchart TB
    subgraph Client["Candidate Browser"]
        CAM[Webcam Stream]
        MIC[Microphone Stream]
        META[Browser Metadata<br/>tab, fullscreen, focus]
    end

    subgraph Ingestion["Event Ingestion"]
        WS[WebSocket Gateway]
        FRAME[Frame Extractor<br/>1 FPS metadata, 0.2 FPS full]
    end

    subgraph AI["AI Proctoring Service (GPU)"]
        FD[Face Detector<br/>MTCNN/RetinaFace]
        FV[Face Verifier<br/>ArcFace]
        MF[Multi-Face Detector]
        ET[Eye Tracker<br/>MediaPipe]
        HP[Head Pose Estimator]
        PD[Phone Detector<br/>YOLOv8]
        AA[Audio Analyzer<br/>VAD + Classification]
        RS[Risk Scoring Engine]
    end

    subgraph Storage["Event Storage"]
        REDIS_E[(Redis Stream)]
        S3_SNAP[(S3 Snapshots)]
        DB_EVENTS[(PostgreSQL Events)]
    end

    subgraph Dashboard["Proctor Dashboard"]
        LIVE[Live Monitoring]
        ALERTS[Alert Manager]
        REVIEW[Recording Review]
    end

    CAM --> WS
    MIC --> WS
    META --> WS
    WS --> FRAME
    FRAME --> FD
    FRAME --> FV
    FRAME --> MF
    FRAME --> ET
    FRAME --> HP
    FRAME --> PD
    MIC --> AA

    FD --> RS
    FV --> RS
    MF --> RS
    ET --> RS
    HP --> RS
    PD --> RS
    AA --> RS

    RS --> REDIS_E
    RS --> S3_SNAP
    RS --> DB_EVENTS
    REDIS_E --> LIVE
    REDIS_E --> ALERTS
    S3_SNAP --> REVIEW
```

## Risk Scoring Engine

### Score Components

| Component | Weight | Range | Description |
|-----------|--------|-------|-------------|
| Face Presence | 20% | 0-100 | No face detected in frame |
| Face Match | 25% | 0-100 | Identity verification confidence |
| Multiple Faces | 20% | 0-100 | More than one person detected |
| Eye Tracking | 15% | 0-100 | Gaze deviation from screen |
| Head Pose | 10% | 0-100 | Head turned away from screen |
| Audio Anomaly | 5% | 0-100 | Background voices, suspicious sounds |
| Phone Detection | 5% | 0-100 | Mobile phone in frame |

### Risk Score Calculation

```python
def calculate_risk_score(components: dict) -> float:
    weights = {
        'face_presence': 0.20,
        'face_match': 0.25,
        'multiple_faces': 0.20,
        'eye_tracking': 0.15,
        'head_pose': 0.10,
        'audio_anomaly': 0.05,
        'phone_detection': 0.05,
    }
    
    score = sum(
        components[key] * weights[key]
        for key in weights
    )
    
    # Apply temporal smoothing (EMA)
    return ema_smooth(score, alpha=0.3)
```

### Threshold Actions

| Risk Score | Level | Action |
|------------|-------|--------|
| 0-30 | LOW | Normal monitoring |
| 31-50 | MEDIUM | Log event, increase snapshot frequency |
| 51-70 | HIGH | Alert proctor, warning to candidate |
| 71-85 | CRITICAL | Proctor intervention required |
| 86-100 | SEVERE | Auto-flag for review, optional auto-terminate |

## Detection Models

### Face Detection & Verification Pipeline

```
Input Frame (640x480)
    │
    ▼
Face Detection (RetinaFace) ──→ Bounding boxes
    │
    ├── 0 faces → violation: NO_FACE (score: 100)
    ├── 1 face  → continue pipeline
    └── 2+ faces → violation: MULTIPLE_FACES (score: 95)
    │
    ▼
Face Alignment (5-point landmarks)
    │
    ▼
Embedding Extraction (ArcFace, 512-dim)
    │
    ▼
Cosine Similarity vs. Reference Photo
    │
    ├── similarity < 0.70 → violation: FACE_MISMATCH (score: 90)
    ├── similarity 0.70-0.85 → warning: LOW_CONFIDENCE (score: 50)
    └── similarity > 0.85 → verified ✓
```

### Eye Tracking

```python
class EyeTracker:
    def analyze(self, frame, face_landmarks):
        left_eye = extract_eye_region(frame, landmarks, 'left')
        right_eye = extract_eye_region(frame, landmarks, 'right')
        
        gaze_vector = estimate_gaze(left_eye, right_eye)
        deviation_angle = angle_from_screen_normal(gaze_vector)
        
        return {
            'lookingAway': deviation_angle > 30,
            'gazeDeviation': deviation_angle,
            'eyesClosed': detect_blink(left_eye, right_eye),
            'score': min(deviation_angle / 45 * 100, 100)
        }
```

## Real-Time Processing Flow

```mermaid
sequenceDiagram
    participant C as Candidate Client
    participant WS as WebSocket
    participant AI as AI Service
    participant R as Redis
    participant P as Proctor Dashboard

    Note over C: Exam starts, WebRTC initialized
    
    loop Every 2 seconds
        C->>WS: proctoring:frame {metadata, thumbnail}
        WS->>AI: Analyze frame (async)
        
        par Parallel Analysis
            AI->>AI: Face detection
            AI->>AI: Face verification
            AI->>AI: Eye tracking
            AI->>AI: Head pose
        end
        
        AI->>AI: Calculate risk score
        AI->>R: Publish event to stream
        
        alt Risk > 70
            AI->>R: Publish alert
            R->>P: Real-time alert notification
            P->>P: Highlight candidate card
        end
        
        AI-->>WS: Analysis result
        WS-->>C: proctoring:status {riskScore, warnings}
    end

    Note over C: Full frame capture every 10 seconds
    C->>WS: proctoring:snapshot {fullFrame}
    WS->>AI: Store snapshot to S3
```

## Client-Side Integration

```typescript
// Exam proctoring client module
class ProctoringClient {
  private mediaStream: MediaStream;
  private frameInterval: number = 2000; // 2 seconds
  private snapshotInterval: number = 10000; // 10 seconds
  private riskScore: number = 0;

  async initialize(referencePhotoUrl: string): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: true,
    });
    
    // Pre-exam identity verification
    const verified = await this.verifyIdentity(referencePhotoUrl);
    if (!verified) throw new ProctoringError('IDENTITY_VERIFICATION_FAILED');
    
    this.startFrameCapture();
    this.startBrowserMonitoring();
  }

  private startBrowserMonitoring(): void {
    document.addEventListener('visibilitychange', () => {
      this.emitEvent('TAB_SWITCH', { visible: !document.hidden });
    });
    
    window.addEventListener('blur', () => {
      this.emitEvent('WINDOW_BLUR', {});
    });
    
    // Fullscreen enforcement
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    }
  }

  private async captureAndAnalyze(): Promise<void> {
    const canvas = this.captureFrame();
    const thumbnail = canvas.toDataURL('image/jpeg', 0.5);
    
    this.socket.emit('proctoring:frame', {
      sessionId: this.sessionId,
      thumbnail,
      timestamp: new Date().toISOString(),
      metadata: {
        tabVisible: !document.hidden,
        fullscreen: !!document.fullscreenElement,
        focused: document.hasFocus(),
      },
    });
  }
}
```

## Proctor Dashboard Features

- **Grid View:** All active candidates with live risk score indicators
- **Alert Feed:** Real-time violation stream sorted by severity
- **Candidate Detail:** Live video feed, violation timeline, risk score graph
- **Intervention Actions:** Send warning, pause exam, terminate session
- **Recording Review:** Post-exam playback with violation markers

## Privacy & Compliance

- Biometric data (face embeddings) encrypted at rest with tenant-specific keys
- Face embeddings deleted 90 days after exam completion (configurable)
- Candidate consent required before proctoring activation
- Proctoring can be disabled per exam (configurable security policy)
- GDPR right to erasure includes all proctoring data

## Performance Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| Frame analysis latency | < 500ms | GPU batching, ONNX Runtime |
| Concurrent streams | 100K+ | Horizontal pod autoscaling |
| Model inference | < 200ms | TensorRT optimization |
| Event delivery | < 100ms | Redis Streams |
| Snapshot storage | < 1s | Async S3 upload |

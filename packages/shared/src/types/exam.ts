import { CodingLanguage, ExamType, SessionStatus } from '../constants/enums';

export interface ExamSecurityPolicy {
  fullscreen: boolean;
  blockCopyPaste: boolean;
  blockRightClick: boolean;
  blockPrint: boolean;
  detectDevTools: boolean;
  detectScreenCapture: boolean;
  detectVirtualMachine: boolean;
  detectVpn: boolean;
  watermark: {
    enabled: boolean;
    content: 'candidateId' | 'email' | 'custom';
    opacity: number;
  };
  allowedBrowsers: string[];
  proctoringEnabled: boolean;
  faceVerificationRequired: boolean;
  riskScoreThreshold: number;
}

export interface ExamSettings {
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
  sectionWiseTiming: boolean;
}

export interface CodeAnswer {
  language: CodingLanguage;
  sourceCode: string;
}

export interface SaveAnswerPayload {
  sessionId: string;
  questionId: string;
  answer: string | string[] | number | CodeAnswer;
  timeSpentSeconds: number;
  markedForReview?: boolean;
  clientTimestamp: string;
}

export interface ExamSessionState {
  sessionId: string;
  examId: string;
  status: SessionStatus;
  timeRemainingSeconds: number;
  currentSectionId?: string;
  currentQuestionIndex: number;
  totalQuestions: number;
  riskScore: number;
}

export interface CreateExamRequest {
  title: string;
  code: string;
  type: ExamType;
  startTime: string;
  endTime: string;
  timezone: string;
  settings: ExamSettings;
  securityPolicy: ExamSecurityPolicy;
}

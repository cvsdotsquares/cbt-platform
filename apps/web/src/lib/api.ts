import { useAuthStore } from '@/stores/auth-store';
import { fetchWithColdStartRetry as fetchWithBackoff } from './cold-start-retry';
import { formatApiErrorPayload } from '@/lib/format-error-message';
import { INSTITUTE_ADMIN_ENABLED, isAdmin, isCandidate, normalizeRoles } from './roles';
import type { AuthUser } from '@cbt/shared';
import { tenantIdForRequestHeader } from '@/lib/tenant-header';

const RENDER_API_BASE =
  process.env.API_PROXY_URL || 'https://cbt-api-ktkr.onrender.com';

function resolvePublicApiBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/api\/v1\/?$/i, '').replace(/\/$/, '');
}

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/**
 * Browser always uses same-origin `/api/v1` proxy (HttpOnly cookie auth, no CORS).
 * SSR uses the configured API base URL.
 */
function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    return '/api/v1';
  }
  return `${RENDER_API_BASE.replace(/\/$/, '')}/api/v1`;
}

/** Same-origin proxy avoids CORS/LAN mismatches and matches cookie auth for uploads. */
function getMaterialsUploadUrl(): string {
  if (typeof window !== 'undefined') {
    return '/api/v1/materials/upload';
  }
  const apiBase = resolvePublicApiBase() || RENDER_API_BASE.replace(/\/$/, '');
  return `${apiBase}/api/v1/materials/upload`;
}

function cloneFormData(source: FormData): FormData {
  const copy = new FormData();
  for (const [key, value] of source.entries()) {
    copy.append(key, value);
  }
  return copy;
}

function getMaterialsBatchUploadUrl(): string {
  return getMaterialsUploadUrl().replace(/\/upload\/?$/, '/upload-batch');
}

async function postMaterialsFormData(token: string, requestUrl: string, formData: FormData) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Device-Fingerprint': getFingerprint(),
  };
  const tenantHeader = tenantIdForRequestHeader(getAuthTenantId());
  if (tenantHeader) headers['X-Tenant-ID'] = tenantHeader;
  const useColdStartRetry = typeof window !== 'undefined' && !isLocalDevHost();

  let res: Response;
  try {
    res = useColdStartRetry
      ? await fetchWithColdStartRetry(requestUrl, { method: 'POST', headers, body: formData, credentials: 'include' })
      : await fetch(requestUrl, { method: 'POST', headers, body: formData, credentials: 'include' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    if (msg === 'Failed to fetch') {
      throw new Error(
        'Could not reach the API. Start FastAPI with: python run_dev.py (from apps/api-fastapi).',
      );
    }
    throw e instanceof Error ? e : new Error(msg);
  }

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`;
      const retryBody = cloneFormData(formData);
      res = useColdStartRetry
        ? await fetchWithColdStartRetry(requestUrl, { method: 'POST', headers, body: retryBody, credentials: 'include' })
        : await fetch(requestUrl, { method: 'POST', headers, body: retryBody, credentials: 'include' });
    }
  }

  const raw = await res.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(formatNonJsonError(raw, res.ok));
  }
  if (!res.ok) throw new Error(formatApiError(data));
  return (data as { data?: unknown }).data ?? data;
}

function isHtmlResponse(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html');
}

function formatNonJsonError(raw: string, ok: boolean): string {
  if (ok) return 'Invalid response from server';
  const lower = raw.toLowerCase();
  if (lower.includes('vercel.com/login') || lower.includes('authentication required')) {
    return 'This preview link requires Vercel login. Use https://cbt-app-jade.vercel.app instead.';
  }
  if (lower.includes('currently unavailable') || lower.includes('onrender.com')) {
    return 'API is waking up (free tier). Wait 30–60 seconds, then try again.';
  }
  return 'API unavailable. Wait 30 seconds and try again.';
}

async function fetchWithColdStartRetry(url: string, init: RequestInit): Promise<Response> {
  return fetchWithBackoff(url, init, (status, raw) =>
    status >= 502 || status === 503 || isHtmlResponse(raw),
  );
}

const DEFAULT_TENANT = process.env.NEXT_PUBLIC_TENANT_ID || 'default';

function getTenantId(): string {
  return DEFAULT_TENANT;
}

function getAuthTenantId(): string {
  if (typeof window !== 'undefined') {
    const tenantId = useAuthStore.getState().user?.tenantId;
    if (tenantId) return tenantId;
  }
  return DEFAULT_TENANT;
}

export interface ApiOptions extends RequestInit {
  token?: string;
  skipAuth?: boolean;
}

let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  try {
    const existing = useAuthStore.getState();
    if (!existing.refreshToken) throw new Error('Refresh failed');
    const data = await authApi.refresh(existing.refreshToken);
    const accessToken = data.accessToken;
    const refreshToken = data.refreshToken ?? existing.refreshToken;
    if (!accessToken || !refreshToken) throw new Error('Refresh failed');
    await existing.updateTokens(accessToken, refreshToken);
    if (data.user) {
      useAuthStore.setState({ user: data.user, isAuthenticated: true });
    }
    return accessToken;
  } catch {
    useAuthStore.getState().logout().finally(() => {
      if (typeof window !== 'undefined') window.location.href = '/login';
    });
    return null;
  }
}

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export type Paginated<T> = {
  items: T[];
  total: number;
  page?: number;
  limit?: number;
  totalPages?: number;
};

export type ExamListItem = {
  id: string;
  title: string;
  code: string;
  status: string;
  startTime: string;
  endTime: string;
  timezone?: string;
  settings?: {
    durationMinutes?: number;
    combinedSubjects?: boolean;
    subjectId?: string;
    [key: string]: unknown;
  };
  sections?: { id: string; name?: string; _count?: { questions: number } }[];
  aiTestConfig?: {
    subjectId?: string | null;
    batch?: {
      id: string;
      name: string;
      academicYear: string;
      academicClass: { id: string; name: string; level: number };
    } | null;
  } | null;
  _count?: {
    registrations: number;
    sessions: number;
    results: number;
    attemptedStudents?: number;
  };
};

export type ExamDetail = Omit<ExamListItem, 'sections'> & {
  registrations?: {
    candidateId: string;
    candidate?: {
      id: string;
      registrationNumber: string;
      user: { firstName: string; lastName: string };
    };
  }[];
  aiTestConfig?: {
    subjectId?: string | null;
    batchId?: string | null;
    batch?: {
      id: string;
      name: string;
      academicYear: string;
      academicClass: { id: string; name: string; level: number };
    } | null;
  } | null;
  sections?: {
    id: string;
    name?: string;
    _count?: { questions: number };
    questions?: {
      questionId: string;
      marks?: number | null;
      negativeMarks?: number | null;
      question: {
        title?: string;
        type: string;
        status: string;
        versions?: {
          content?: { text?: string };
          options?: Record<string, string>;
          correctAnswer?: { value?: string | string[] };
          marks?: number;
          negativeMarks?: number;
        }[];
      };
    }[];
  }[];
};

export type CandidateListItem = {
  id: string;
  registrationNumber: string;
  gender?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  kycStatus?: string;
  createdAt?: string;
  createdBy?: { id: string; name: string; email: string } | null;
  user: { firstName: string; lastName: string; email: string; phone?: string | null; status?: string };
  batchEnrollments?: {
    id: string;
    rollNumber?: string | null;
    batch: {
      id: string;
      name: string;
      academicYear: string;
      academicClass: { id: string; name: string; level: number };
    };
  }[];
};

export type CandidateKycDetail = {
  id: string;
  registrationNumber: string;
  gender?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  kycStatus: string;
  profileData?: {
    documentType?: string;
    idNumber?: string;
    nameOnDocument?: string;
    dateOfBirth?: string;
    submittedAt?: string;
    aiVerification?: {
      outcome?: 'VERIFIED' | 'MANUAL_REVIEW';
      documentType?: string;
      confidence?: number;
      extractedIdNumber?: string;
      nameOnDocument?: string;
      dateOfBirth?: string;
      reasons?: string[];
      note?: string;
      checkedAt?: string;
    };
  } | null;
  user: { email: string; firstName: string; lastName: string; phone?: string | null };
  documents: {
    id: string;
    type: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
    uploadedAt?: string | null;
  }[];
};

export type QuestionListItem = {
  id: string;
  title: string | null;
  type: string;
  difficulty: string;
  status: string;
  versions?: { content?: { text?: string } }[];
};

export type AuditLogItem = {
  id: string;
  action: string;
  entityType?: string;
  resourceType?: string;
  entityId?: string;
  ipAddress?: string;
  createdAt: string;
  user?: { firstName?: string; lastName?: string; email: string };
};

export type ExamAnalytics = {
  registered: number;
  submitted: number;
  violations: number;
  completionRate: number;
  averageScore: number;
};

export type ExamResultListItem = {
  id: string;
  rank?: number | null;
  totalScore: number;
  maxScore: number;
  percentage: number;
  published: boolean;
  candidate: { user: { firstName: string; lastName: string } };
};

export type SubjectiveResponseItem = {
  id: string;
  sessionId: string;
  questionId: string;
  answer: unknown;
  marksAwarded: number | null;
  question: { title: string; type: string; versions: { marks: number }[] };
  session: { candidate: { user: { firstName: string; lastName: string; email: string } } };
};

export type ResultReviewQuestion = {
  number: number;
  questionId: string;
  type: string;
  title: string;
  text: string;
  sectionName: string;
  options: Record<string, string>;
  candidateAnswer: string[];
  candidateAnswerLabel: string;
  correctAnswer: string[];
  correctAnswerLabel: string;
  isCorrect: boolean | null;
  marksAwarded: number | null;
  maxMarks: number;
  explanation: string | null;
  answered: boolean;
};

export type ResultReview = {
  resultId: string;
  sessionId?: string;
  examTitle: string;
  examCode: string;
  candidateName: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  published: boolean;
  questions: ResultReviewQuestion[];
};

export async function apiFetch<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { token, skipAuth, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  let authToken = token;
  if (!skipAuth && !authToken) {
    authToken = useAuthStore.getState().accessToken ?? undefined;
  }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const tenantHeader = tenantIdForRequestHeader(
    skipAuth ? getTenantId() : getAuthTenantId(),
  );
  if (tenantHeader) headers['X-Tenant-ID'] = tenantHeader;

  const requestUrl = `${getApiUrl()}${endpoint}`;
  const useColdStartRetry = typeof window !== 'undefined' && !isLocalDevHost();

  let response = useColdStartRetry
    ? await fetchWithColdStartRetry(requestUrl, { ...fetchOptions, headers, credentials: 'include' })
    : await fetch(requestUrl, { ...fetchOptions, headers, credentials: 'include' });

  if (response.status === 401 && !skipAuth && !endpoint.includes('/auth/refresh')) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      response = useColdStartRetry
        ? await fetchWithColdStartRetry(requestUrl, { ...fetchOptions, headers, credentials: 'include' })
        : await fetch(requestUrl, { ...fetchOptions, headers, credentials: 'include' });
    }
  }

  const raw = await response.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(formatNonJsonError(raw, response.ok));
  }
  if (!response.ok) {
    throw new Error(formatApiError(data));
  }
  return (data as { data?: T }).data ?? (data as T);
}

function formatApiError(data: unknown): string {
  return formatApiErrorPayload(data);
}

function isRetryableAiTransportError(message: string): boolean {
  return /network\/dns|getaddrinfo|502|503|unavailable|could not reach the ai provider/i.test(message);
}

async function apiFetchWithAiRetry<T>(
  endpoint: string,
  options: ApiOptions = {},
  maxAttempts = 7,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await apiFetch<T>(endpoint, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetryableAiTransportError(lastError.message) || attempt === maxAttempts - 1) {
        throw lastError;
      }
      const delayMs = Math.min(15_000, 750 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError ?? new Error('Request failed');
}

function authHeaders(token: string) {
  return { token, headers: { 'X-Device-Fingerprint': getFingerprint() } };
}

function bearerFetchHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Device-Fingerprint': getFingerprint(),
  };
  const tenantHeader = tenantIdForRequestHeader(getAuthTenantId());
  if (tenantHeader) headers['X-Tenant-ID'] = tenantHeader;
  return headers;
}

export function getFingerprint() {
  if (typeof window === 'undefined') return 'server';
  let fp = localStorage.getItem('device-fp');
  if (!fp) {
    fp = `fp-${navigator.userAgent.slice(0, 30)}-${Date.now()}`;
    localStorage.setItem('device-fp', fp);
  }
  return fp;
}

function normalizeAuthUser(raw: Record<string, unknown> | undefined): AuthUser | undefined {
  if (!raw || typeof raw.id !== 'string' || typeof raw.email !== 'string') return undefined;
  const role = typeof raw.role === 'string' ? raw.role : undefined;
  const rolesRaw = Array.isArray(raw.roles) ? raw.roles : role ? [role] : [];
  return {
    id: raw.id,
    email: raw.email,
    firstName: String(raw.firstName ?? raw.first_name ?? ''),
    lastName: String(raw.lastName ?? raw.last_name ?? ''),
    tenantId: String(raw.tenantId ?? raw.tenant_id ?? ''),
    roles: normalizeRoles(rolesRaw as string[]) as AuthUser['roles'],
    mfaEnabled: Boolean(raw.mfaEnabled ?? raw.mfa_enabled ?? false),
  };
}

function normalizeLoginResponse(raw: Record<string, unknown>) {
  return {
    accessToken: (raw.accessToken ?? raw.access_token) as string | undefined,
    refreshToken: (raw.refreshToken ?? raw.refresh_token) as string | undefined,
    mfaRequired: (raw.mfaRequired ?? raw.mfa_required) as boolean | undefined,
    mfaToken: (raw.mfaToken ?? raw.mfa_token) as string | undefined,
    user: normalizeAuthUser(raw.user as Record<string, unknown> | undefined),
  };
}

export const authApi = {
  login: async (body: { email: string; password: string }) => {
    const tenantId = getTenantId();
    const payload: Record<string, string> = {
      ...body,
      deviceFingerprint: getFingerprint(),
    };
    if (tenantId && tenantId !== 'default') {
      payload.tenantId = tenantId;
    }
    const raw = await apiFetch<Record<string, unknown>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true,
    });
    return normalizeLoginResponse(raw);
  },
  register: (body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    inviteCode?: string;
  }) =>
    apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ ...body, deviceFingerprint: getFingerprint() }),
      skipAuth: true,
    }),
  validateInvite: (inviteCode: string, options?: Pick<ApiOptions, 'signal'>) =>
    apiFetch<{ email: string; firstName?: string | null; lastName?: string | null; expiresAt: string }>(
      '/auth/invite/validate',
      {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
        skipAuth: true,
        ...options,
      },
    ),
  verifyMfa: (body: { mfaToken: string; totpCode: string }) =>
    apiFetch('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuth: true,
    }),
  refresh: async (refreshToken: string) => {
    const raw = await apiFetch<Record<string, unknown>>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      skipAuth: true,
    });
    return normalizeLoginResponse(raw);
  },
  logout: (token: string) =>
    apiFetch('/auth/logout', { method: 'POST', ...authHeaders(token) }),
  effectivePermissions: (token: string) =>
    apiFetch<{ permissions: string[]; customized: boolean }>('/auth/effective-permissions', authHeaders(token)),
  sessions: (token: string) => apiFetch('/auth/sessions', authHeaders(token)),
  loginHistory: (token: string) => apiFetch('/auth/login-history', authHeaders(token)),
};

export const dashboardApi = {
  stats: (token: string) => apiFetch('/analytics/dashboard', authHeaders(token)),
  submissionsForDay: (token: string, from: string, to: string) =>
    apiFetch(
      `/analytics/dashboard/submissions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      authHeaders(token),
    ),
  dismissViolation: (token: string, eventId: string) =>
    apiFetch(`/analytics/violations/${eventId}/dismiss`, { method: 'POST', ...authHeaders(token) }),
  dismissAllViolations: (token: string) =>
    apiFetch('/analytics/violations/dismiss-all', { method: 'POST', ...authHeaders(token) }),
  purgeRecycleBinViolations: (token: string) =>
    apiFetch('/analytics/violations/purge-recycle-bin', { method: 'POST', ...authHeaders(token) }),
  restoreViolation: (token: string, eventId: string) =>
    apiFetch(`/analytics/violations/${eventId}/restore`, { method: 'POST', ...authHeaders(token) }),
};

export const examsApi = {
  list: (token: string, page = 1, search = '', limit = 20, publishedOnly = false) =>
    apiFetch<Paginated<ExamListItem>>(
      `/exams?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}${publishedOnly ? '&publishedOnly=true' : ''}`,
      authHeaders(token),
    ),
  get: (token: string, id: string) => apiFetch<ExamDetail>(`/exams/${id}`, authHeaders(token)),
  instructions: (token: string, id: string) => apiFetch(`/exams/${id}/instructions`, authHeaders(token)),
  create: (token: string, body: unknown) =>
    apiFetch('/exams', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  publish: (token: string, id: string) =>
    apiFetch(`/exams/${id}/publish`, { method: 'POST', ...authHeaders(token) }),
  assignCandidates: (token: string, id: string, candidateIds: string[]) =>
    apiFetch<{ count?: number; skipped?: number }>(`/exams/${id}/candidates`, {
      method: 'POST',
      body: JSON.stringify({ candidateIds }),
      ...authHeaders(token),
    }),
  syncCandidates: (token: string, id: string, candidateIds: string[]) =>
    apiFetch<{ assigned?: number; added?: number; removed?: number }>(`/exams/${id}/candidates`, {
      method: 'PUT',
      body: JSON.stringify({ candidateIds }),
      ...authHeaders(token),
    }),
  addQuestions: (token: string, id: string, sectionId: string, questionIds: string[]) =>
    apiFetch<{ added?: number; skipped?: number }>(`/exams/${id}/questions`, {
      method: 'POST',
      body: JSON.stringify({ sectionId, questionIds }),
      ...authHeaders(token),
    }),
  removeQuestion: (token: string, examId: string, questionId: string) =>
    apiFetch(`/exams/${examId}/questions/${questionId}`, { method: 'DELETE', ...authHeaders(token) }),
  remove: (token: string, id: string) =>
    apiFetch(`/exams/${id}`, { method: 'DELETE', ...authHeaders(token) }),
  updateSchedule: (token: string, id: string, body: {
    passingScore?: number;
    maxAttempts?: number;
    startTime: string;
    endTime: string;
    timezone?: string;
    durationMinutes?: number;
  }) =>
    apiFetch(`/exams/${id}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
  myExams: (token: string) => apiFetch('/exams/my/available', authHeaders(token)),
};

export const questionsApi = {
  list: (token: string, page = 1, filters: { search?: string; type?: string; status?: string; limit?: number } = {}) => {
    const params = new URLSearchParams({ page: String(page), limit: String(filters.limit ?? 20) });
    if (filters.search) params.set('search', filters.search);
    if (filters.type) params.set('type', filters.type);
    if (filters.status) params.set('status', filters.status);
    return apiFetch<Paginated<QuestionListItem>>(`/questions?${params}`, authHeaders(token));
  },
  create: (token: string, body: unknown) =>
    apiFetch('/questions', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  get: (token: string, id: string) =>
    apiFetch<QuestionListItem>(`/questions/${id}`, authHeaders(token)),
  update: (token: string, id: string, body: unknown) =>
    apiFetch(`/questions/${id}`, { method: 'PATCH', body: JSON.stringify(body), ...authHeaders(token) }),
  approve: (token: string, id: string) =>
    apiFetch(`/questions/${id}/approve`, { method: 'POST', ...authHeaders(token) }),
  remove: (token: string, id: string) =>
    apiFetch(`/questions/${id}`, { method: 'DELETE', ...authHeaders(token) }),
};

export const candidatesApi = {
  list: (
    token: string,
    page = 1,
    search = '',
    limit = 20,
    filters?: { batchId?: string; academicClassId?: string; unassigned?: boolean },
  ) => {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) q.set('search', search);
    if (filters?.batchId) q.set('batchId', filters.batchId);
    if (filters?.academicClassId) q.set('academicClassId', filters.academicClassId);
    if (filters?.unassigned) q.set('unassigned', 'true');
    return apiFetch<Paginated<CandidateListItem>>(`/candidates?${q}`, authHeaders(token));
  },
  create: (token: string, body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    gender: string;
    studentMobile: string;
    guardianName: string;
    guardianPhone: string;
    registrationNumber?: string;
    batchId: string;
    rollNumber?: string;
  }) =>
    apiFetch('/candidates', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  createRegistrationInvite: (
    token: string,
    body: {
      email: string;
      firstName?: string;
      lastName?: string;
      batchId?: string;
      registrationNumber?: string;
      expiresInDays?: number;
    },
  ) =>
    apiFetch<{ signupUrl: string; inviteToken: string; email: string; expiresAt: string }>(
      '/candidates/registration-invites',
      { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) },
    ),
  listRegistrationInvites: (token: string, page = 1, limit = 50) => {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    return apiFetch<Paginated<{
      id: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      expiresAt?: string | null;
      createdAt?: string | null;
      batch?: { id: string; name: string; academicYear: string } | null;
    }>>(`/candidates/registration-invites?${q}`, authHeaders(token));
  },
  dashboard: (token: string) => apiFetch('/candidates/me/dashboard', authHeaders(token)),
  admitCard: (token: string, examId: string) =>
    apiFetch(`/candidates/me/admit-card/${examId}`, authHeaders(token)),
  get: (token: string, id: string) =>
    apiFetch<CandidateKycDetail>(`/candidates/${id}`, authHeaders(token)),
  getKycReview: (token: string, id: string) =>
    apiFetch<CandidateKycDetail>(`/candidates/${id}/kyc`, authHeaders(token)),
  verifyKyc: (token: string, id: string, status: 'VERIFIED' | 'REJECTED') =>
    apiFetch(`/candidates/${id}/kyc/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
      ...authHeaders(token),
    }),
  stats: (token: string) => apiFetch('/candidates/stats', authHeaders(token)),
  update: (
    token: string,
    id: string,
    body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      registrationNumber?: string;
      status?: string;
      password?: string;
    },
  ) => apiFetch(`/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(body), ...authHeaders(token) }),
  remove: (token: string, id: string) =>
    apiFetch(`/candidates/${id}`, { method: 'DELETE', ...authHeaders(token) }),
  setBatch: (token: string, id: string, body: { batchId: string | null; rollNumber?: string }) =>
    apiFetch(`/candidates/${id}/batch`, { method: 'PATCH', body: JSON.stringify(body), ...authHeaders(token) }),
  submitKyc: (
    token: string,
    body: { fileName: string; fileData: string },
  ) =>
    apiFetch<{
      kycStatus: string;
      documentType: string;
      verificationSource: 'AI' | 'ADMIN';
      message: string;
      extracted: {
        documentType: string;
        name: string;
        idNumber: string;
        dateOfBirth: string;
      };
    }>('/candidates/me/kyc', {
      method: 'POST',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
};

export const usersApi = {
  list: (token: string, page = 1, search = '', limit = 20, includeInactive = false) =>
    apiFetch(
      `/users?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}${includeInactive ? '&includeInactive=true' : ''}`,
      authHeaders(token),
    ),
  create: (token: string, body: { email: string; password: string; firstName: string; lastName: string; roleIds?: string[] }) =>
    apiFetch('/users', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  get: (token: string, id: string) => apiFetch(`/users/${id}`, authHeaders(token)),
  roles: (token: string) => apiFetch('/users/meta/roles', authHeaders(token)),
  assignRole: (token: string, userId: string, roleId: string) =>
    apiFetch(`/users/${userId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ roleId }),
      ...authHeaders(token),
    }),
  removeRole: (token: string, userId: string, roleId: string) =>
    apiFetch(`/users/${userId}/roles/${roleId}`, { method: 'DELETE', ...authHeaders(token) }),
  update: (
    token: string,
    id: string,
    body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      status?: string;
      password?: string;
      roleId?: string | null;
    },
  ) => apiFetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body), ...authHeaders(token) }),
  remove: (token: string, id: string) =>
    apiFetch(`/users/${id}`, { method: 'DELETE', ...authHeaders(token) }),
  inactiveCount: (token: string) =>
    apiFetch<{ count: number }>('/users/meta/inactive-count', authHeaders(token)),
  purgeInactive: (token: string) =>
    apiFetch<{ deleted: number; ids: string[]; skipped?: number }>(
      '/users/inactive',
      { method: 'DELETE', ...authHeaders(token) },
    ),
};

export const resultsApi = {
  byExam: (token: string, examId: string) =>
    apiFetch<Paginated<ExamResultListItem>>(`/results/exam/${examId}`, authHeaders(token)),
  exportCsv: async (token: string, examId: string) => {
    const url = `${getApiUrl()}/results/exam/${examId}/export`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    const tenantHeader = tenantIdForRequestHeader(getAuthTenantId());
    if (tenantHeader) headers['X-Tenant-ID'] = tenantHeader;
    const useRetry = typeof window !== 'undefined' && !isLocalDevHost();
    const res = useRetry
      ? await fetchWithColdStartRetry(url, { headers, credentials: 'include' })
      : await fetch(url, { headers, credentials: 'include' });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
  my: (token: string) => apiFetch('/results/my', authHeaders(token)),
  review: (token: string, resultId: string) =>
    apiFetch<ResultReview>(`/results/review/${resultId}`, authHeaders(token)),
  certificate: (token: string, resultId: string) =>
    apiFetch(`/results/my/${resultId}/certificate`, authHeaders(token)),
  evaluate: (token: string, sessionId: string) =>
    apiFetch(`/results/evaluate/${sessionId}`, { method: 'POST', ...authHeaders(token) }),
  rank: (token: string, examId: string) =>
    apiFetch(`/results/rank/${examId}`, { method: 'POST', ...authHeaders(token) }),
  publish: (token: string, examId: string) =>
    apiFetch(`/results/publish/${examId}`, { method: 'POST', ...authHeaders(token) }),
  subjective: (token: string, examId: string) =>
    apiFetch<SubjectiveResponseItem[]>(`/results/exam/${examId}/subjective`, authHeaders(token)),
  grade: (token: string, sessionId: string, questionId: string, marksAwarded: number) =>
    apiFetch(`/results/grade/${sessionId}/${questionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ marksAwarded }),
      ...authHeaders(token),
    }),
  verifyCertificate: (resultId: string) =>
    apiFetch(`/results/verify/${resultId}`, { skipAuth: true }),
};

export const examSessionApi = {
  start: (token: string, examId: string) =>
    apiFetch('/exam-sessions/start', {
      method: 'POST',
      body: JSON.stringify({ examId }),
      ...authHeaders(token),
    }),
  get: (token: string, sessionId: string) =>
    apiFetch(`/exam-sessions/${sessionId}`, authHeaders(token)),
  saveAnswer: (token: string, sessionId: string, body: unknown) =>
    apiFetch(`/exam-sessions/${sessionId}/responses`, {
      method: 'POST',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
  markReview: (token: string, sessionId: string, questionId: string, marked: boolean) =>
    apiFetch(`/exam-sessions/${sessionId}/mark-review`, {
      method: 'POST',
      body: JSON.stringify({ questionId, marked }),
      ...authHeaders(token),
    }),
  submit: (
    token: string,
    sessionId: string,
    body?: {
      answers?: {
        questionId: string;
        answer: unknown;
        timeSpentSeconds?: number;
        markedForReview?: boolean;
      }[];
    },
  ) =>
    apiFetch(`/exam-sessions/${sessionId}/submit`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      ...authHeaders(token),
    }),
  heartbeat: (
    token: string,
    sessionId: string,
    body?: {
      answers?: {
        questionId: string;
        answer: unknown;
        timeSpentSeconds?: number;
        markedForReview?: boolean;
      }[];
    },
  ) =>
    apiFetch(`/exam-sessions/${sessionId}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      ...authHeaders(token),
    }),
};

export const proctoringApi = {
  recordEvent: (token: string, body: {
    sessionId: string;
    eventType: string;
    severity?: string;
    metadata?: Record<string, unknown>;
  }) =>
    apiFetch('/proctoring/events', {
      method: 'POST',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
  eventDetail: (token: string, eventId: string) =>
    apiFetch(`/proctoring/events/${eventId}`, authHeaders(token)),
  live: (token: string, examId: string) =>
    apiFetch(`/proctoring/sessions/${examId}/live`, authHeaders(token)),
  liveFeeds: (token: string, examId: string) =>
    apiFetch<{ examId: string; feeds: Record<string, { screen?: string; camera?: string; updatedAt: string }> }>(
      `/proctoring/sessions/${examId}/live-feeds`,
      authHeaders(token),
    ),
  uploadLiveFrame: (token: string, sessionId: string, body: { thumbnail: string; source: 'screen' | 'camera' }) =>
    apiFetch(`/proctoring/sessions/${sessionId}/live-frame`, {
      method: 'POST',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
  intervene: (token: string, sessionId: string, type: string, message?: string) =>
    apiFetch(`/proctoring/sessions/${sessionId}/intervene`, {
      method: 'POST',
      body: JSON.stringify({ type, message }),
      ...authHeaders(token),
    }),
};

export const auditApi = {
  list: (token: string, page = 1, limit = 20) =>
    apiFetch<Paginated<AuditLogItem>>(`/audit/logs?page=${page}&limit=${limit}`, authHeaders(token)),
};

export const analyticsApi = {
  exam: (token: string, examId: string) =>
    apiFetch<ExamAnalytics>(`/analytics/exam/${examId}`, authHeaders(token)),
  violationDetail: (token: string, eventId: string) =>
    apiFetch(`/analytics/violations/${encodeURIComponent(eventId)}`, authHeaders(token)),
};

export const aiApi = {
  status: (token: string) => apiFetch('/ai/status', authHeaders(token)),
  generateQuestions: (token: string, body: { topic: string; count?: number; difficulty?: string; type?: string }) =>
    apiFetch('/ai/questions/generate', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  generateRagQuestions: (token: string, body: {
    subjectId: string; batchId?: string; chapterIds?: string[];
    topicIds?: string[]; syllabusScope?: string; count?: number;
    difficulty?: string; types?: string[];
  }) => apiFetch('/ai/rag/generate', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  createAiTest: (token: string, body: {
    title: string; subjectId?: string; batchId?: string; allSubjects?: boolean;
    chapterIds?: string[]; questionCount?: number; questionsPerSubject?: number;
    difficulty?: string; questionTypes?: string[]; syllabusScope?: string;
    durationMinutes?: number; assignToBatch?: boolean; shuffleQuestions?: boolean;
  }) => apiFetch('/ai/tests/create', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  generateReferenceAnswer: (token: string, body: {
    questionText: string;
    questionType: string;
    subjectName?: string;
    chapterTitle?: string;
    chapterId?: string;
    options?: Record<string, string>;
    regenerate?: boolean;
  }) => apiFetchWithAiRetry<{
    referenceAnswer?: string;
    rubric?: string;
    options?: Record<string, string>;
    correctAnswer?: { value: string | string[]; rubric?: string };
  }>('/ai/reference-answer/generate', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  explain: (token: string, body: { questionText: string; correctAnswer: string }) =>
    apiFetch('/ai/explain', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  examInsights: (token: string, examId: string) =>
    apiFetch(`/ai/insights/exam/${examId}`, authHeaders(token)),
  chat: (token: string, message: string, context?: { page?: string }) =>
    apiFetch('/ai/chat', { method: 'POST', body: JSON.stringify({ message, context }), ...authHeaders(token) }),
};

export const curriculumApi = {
  getClasses: (token: string, options?: { uploadedOnly?: boolean; includeTopics?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.uploadedOnly) params.set('uploadedOnly', 'true');
    if (options?.includeTopics) params.set('includeTopics', 'true');
    const q = params.toString() ? `?${params}` : '';
    return apiFetch(`/curriculum/classes${q}`, authHeaders(token));
  },
  getClass: (token: string, id: string) => apiFetch(`/curriculum/classes/${id}`, authHeaders(token)),
  getSubjectChapters: (token: string, subjectId: string) =>
    apiFetch(`/curriculum/subjects/${subjectId}/chapters`, authHeaders(token)),
  createSubject: (
    token: string,
    body: { academicClassId: string; name: string; code?: string; description?: string },
  ) =>
    apiFetch('/curriculum/subjects', {
      method: 'POST',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
  getOfferedSubjects: (token: string, academicClassId: string) =>
    apiFetch<{
      academicClassId: string;
      configured: boolean;
      offeredSubjectIds: string[];
      subjects: { id: string; name: string; code: string; offered: boolean; canDelete: boolean }[];
      catalogSubjects?: { id: string; name: string; code: string; offered: boolean; canDelete: boolean }[];
    }>(`/curriculum/classes/${academicClassId}/offered-subjects`, authHeaders(token)),
  setOfferedSubjects: (token: string, academicClassId: string, subjectIds: string[]) =>
    apiFetch(`/curriculum/classes/${academicClassId}/offered-subjects`, {
      method: 'PUT',
      body: JSON.stringify({ subjectIds }),
      ...authHeaders(token),
    }),
  deleteSubject: (token: string, subjectId: string) =>
    apiFetch(`/curriculum/subjects/${subjectId}`, { method: 'DELETE', ...authHeaders(token) }),
};

export const batchesApi = {
  list: (token: string) => apiFetch('/batches', authHeaders(token)),
  get: (token: string, id: string) => apiFetch(`/batches/${id}`, authHeaders(token)),
  create: (token: string, body: { academicClassId: string; name: string; academicYear: string }) =>
    apiFetch('/batches', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  update: (token: string, id: string, body: { academicClassId?: string; name?: string; academicYear?: string; isActive?: boolean }) =>
    apiFetch(`/batches/${id}`, { method: 'PATCH', body: JSON.stringify(body), ...authHeaders(token) }),
  remove: (token: string, id: string) =>
    apiFetch(`/batches/${id}`, { method: 'DELETE', ...authHeaders(token) }),
  nextRollNumber: (token: string, batchId: string) =>
    apiFetch<{ rollNumber: string }>(`/batches/${batchId}/next-roll-number`, authHeaders(token)),
  enroll: (token: string, batchId: string, body: { candidateId: string; rollNumber?: string }) =>
    apiFetch(`/batches/${batchId}/enroll`, { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  listTeachers: (token: string, batchId: string) =>
    apiFetch(`/batches/${batchId}/teachers`, authHeaders(token)),
  listTeacherAssignmentsByUser: (token: string, userId?: string) =>
    apiFetch(`/batches/teacher-assignments${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, authHeaders(token)),
  assignTeacher: (token: string, batchId: string, body: { userId: string; subjectId?: string; subjectIds?: string[] }) =>
    apiFetch(`/batches/${batchId}/teachers`, { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  updateTeacher: (
    token: string,
    batchId: string,
    assignmentId: string,
    body: { userId: string; subjectId: string },
  ) =>
    apiFetch(`/batches/${batchId}/teachers/${assignmentId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
  removeTeacher: (token: string, batchId: string, assignmentId: string) =>
    apiFetch(`/batches/${batchId}/teachers/${assignmentId}`, { method: 'DELETE', ...authHeaders(token) }),
  getSyllabusProgress: (token: string, batchId: string, subjectId?: string) =>
    apiFetch(`/batches/${batchId}/syllabus-progress${subjectId ? `?subjectId=${subjectId}` : ''}`, authHeaders(token)),
  updateSyllabusProgress: (token: string, batchId: string, body: { chapterId?: string; topicId?: string; materialId?: string; status: string }) =>
    apiFetch(`/batches/${batchId}/syllabus-progress`, { method: 'PATCH', body: JSON.stringify(body), ...authHeaders(token) }),
};

export const materialsApi = {
  list: (token: string, params?: {
    chapterId?: string;
    type?: string;
    academicClassId?: string;
    subjectId?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.chapterId) q.set('chapterId', params.chapterId);
    if (params?.type) q.set('type', params.type);
    if (params?.academicClassId) q.set('academicClassId', params.academicClassId);
    if (params?.subjectId) q.set('subjectId', params.subjectId);
    return apiFetch(`/materials?${q}`, authHeaders(token));
  },
  upload: (token: string, formData: FormData) =>
    postMaterialsFormData(token, getMaterialsUploadUrl(), formData),
  uploadBatch: (token: string, formData: FormData) =>
    postMaterialsFormData(token, getMaterialsBatchUploadUrl(), formData),
  reconcileSubjects: (token: string) =>
    apiFetch('/materials/reconcile-subjects', { method: 'POST', ...authHeaders(token) }),
  update: (
    token: string,
    id: string,
    body: { title?: string; academicClassId?: string; subjectId?: string },
  ) =>
    apiFetch(`/materials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...authHeaders(token),
    }),
  reindex: (token: string, id: string) =>
    apiFetch(`/materials/${id}/reindex`, { method: 'POST', ...authHeaders(token) }),
  chapters: (token: string, id: string) =>
    apiFetch(`/materials/${id}/chapters`, authHeaders(token)),
  delete: (token: string, id: string) =>
    apiFetch(`/materials/${id}`, { method: 'DELETE', ...authHeaders(token) }),
  openFile: async (token: string, id: string) => {
    const url = `${getApiUrl()}/materials/${id}/file`;
    const res = await fetch(url, {
      headers: bearerFetchHeaders(token),
      credentials: 'include',
    });
    if (!res.ok) {
      const raw = await res.text();
      let message = 'Could not open file';
      try {
        message = formatApiError(JSON.parse(raw));
      } catch {
        if (raw && !raw.trimStart().startsWith('{')) message = raw;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  },
  createFileObjectUrl: async (token: string, id: string) => {
    const url = `${getApiUrl()}/materials/${id}/file`;
    const res = await fetch(url, {
      headers: bearerFetchHeaders(token),
      credentials: 'include',
    });
    if (!res.ok) {
      const raw = await res.text();
      let message = 'Could not load file';
      try {
        message = formatApiError(JSON.parse(raw));
      } catch {
        if (raw && !raw.trimStart().startsWith('{')) message = raw;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  downloadFile: async (token: string, id: string, fileName: string) => {
    const url = `${getApiUrl()}/materials/${id}/file?download=1`;
    const res = await fetch(url, {
      headers: bearerFetchHeaders(token),
      credentials: 'include',
    });
    if (!res.ok) {
      const raw = await res.text();
      let message = 'Could not download file';
      try {
        message = formatApiError(JSON.parse(raw));
      } catch {
        if (raw && !raw.trimStart().startsWith('{')) message = raw;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(objectUrl);
  },
};

export const learningApi = {
  studentDashboard: (token: string) => apiFetch('/learning/student/dashboard', authHeaders(token)),
  instituteLessons: (token: string) =>
    apiFetch<{
      items: {
        id: string;
        chapterId: string;
        batchId: string;
        title: string;
        description: string;
        subjectName: string;
        batchName: string;
        className: string;
        chapterNumber: number;
        status: 'planned' | 'in-progress' | 'completed';
      }[];
      batchCount: number;
    }>('/learning/institute/lessons', authHeaders(token)),
  recommendations: (token: string) => apiFetch('/learning/student/recommendations', authHeaders(token)),
  teacherAnalytics: (token: string, batchId: string, subjectId?: string) =>
    apiFetch(`/learning/teacher/batch/${batchId}/analytics${subjectId ? `?subjectId=${subjectId}` : ''}`, authHeaders(token)),
};

export const onboardingApi = {
  setupStatus: (token: string) => apiFetch('/onboarding/setup-status', authHeaders(token)),
};

export type RolePermissionMatrix = {
  roles: { name: string; label: string; description: string }[];
  columns: string[];
  modules: { key: string; label: string; cells: Record<string, string> }[];
  teachers: { id: string; name: string; email: string; assignments?: string[] }[];
  granted: Record<string, string[]>;
  teacherGranted: Record<string, string[]>;
  defaults: Record<string, string[]>;
  customized: Record<string, boolean>;
  teacherCustomized: Record<string, boolean>;
};

const DISABLED_ROLE_PERMISSION_ROLES = new Set(['INSTITUTE_ADMIN']);

function withoutDisabledRolePermissionRoles(matrix: RolePermissionMatrix): RolePermissionMatrix {
  if (INSTITUTE_ADMIN_ENABLED) return matrix;
  const roles = matrix.roles.filter((role) => !DISABLED_ROLE_PERMISSION_ROLES.has(role.name));
  const omitDisabled = <T extends Record<string, unknown>>(record: T) => {
    const next = { ...record };
    for (const name of DISABLED_ROLE_PERMISSION_ROLES) {
      delete next[name];
    }
    return next;
  };
  return {
    ...matrix,
    roles,
    granted: omitDisabled(matrix.granted),
    defaults: omitDisabled(matrix.defaults),
    customized: omitDisabled(matrix.customized),
  };
}

export const rolePermissionsApi = {
  matrix: async (token: string) =>
    withoutDisabledRolePermissionRoles(
      await apiFetch<RolePermissionMatrix>('/role-permissions', authHeaders(token)),
    ),
  save: async (token: string, role: string, permissions: string[], userId?: string) =>
    withoutDisabledRolePermissionRoles(
      await apiFetch<RolePermissionMatrix>('/role-permissions', {
        method: 'PUT',
        body: JSON.stringify({ role, permissions, userId: userId || undefined }),
        ...authHeaders(token),
      }),
    ),
  reset: async (token: string, role: string, userId?: string) =>
    withoutDisabledRolePermissionRoles(
      await apiFetch<RolePermissionMatrix>('/role-permissions', {
        method: 'PUT',
        body: JSON.stringify({ role, reset: true, permissions: [], userId: userId || undefined }),
        ...authHeaders(token),
      }),
    ),
};

export const tenantsApi = {
  list: (token: string, page = 1) => apiFetch(`/tenants?page=${page}`, authHeaders(token)),
  create: (token: string, body: { name: string; slug: string; domain?: string }) =>
    apiFetch('/tenants', { method: 'POST', body: JSON.stringify(body), ...authHeaders(token) }),
  get: (token: string, id: string) => apiFetch(`/tenants/${id}`, authHeaders(token)),
  getMyBranding: (token: string) =>
    apiFetch<{ id: string; name: string; branding?: { primaryColor?: string } }>(
      '/tenants/me/branding',
      authHeaders(token),
    ),
  updateBranding: (token: string, id: string, branding: unknown) =>
    apiFetch(`/tenants/${encodeURIComponent(id)}/branding`, {
      method: 'PATCH',
      body: JSON.stringify(branding),
      ...authHeaders(token),
    }),
};

export { isAdmin, isCandidate, normalizeRoles };


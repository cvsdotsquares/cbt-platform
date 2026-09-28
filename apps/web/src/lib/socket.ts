import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

function getWsUrl(): string {
  const explicitWs = process.env.NEXT_PUBLIC_WS_URL?.trim();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() || '';
  const apiIsFastApi = apiUrl.includes(':8000');

  if (explicitWs) {
    // FastAPI (:8000) has no Socket.IO; use REST live-feed polling instead.
    if (explicitWs.includes(':8000')) return '';
    return explicitWs;
  }

  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (apiIsFastApi) return '';
    }
  }

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    if (hostname.endsWith('.vercel.app')) {
      return 'wss://cbt-api-ktkr.onrender.com';
    }
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${hostname}`;
  }

  return 'http://localhost:4000';
}

let proctoringSocket: Socket | null = null;
let examSocket: Socket | null = null;
let cachedWsAuth: { token: string; tenantId: string; role: string } | null = null;

async function fetchWsAuth(): Promise<typeof cachedWsAuth> {
  const accessToken = useAuthStore.getState().accessToken;
  const res = await fetch('/api/auth/ws-token', {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = await res.json();
  const role = data.role || 'candidate';
  cachedWsAuth = {
    token: data.token as string,
    tenantId: (data.tenantId as string) || 'default',
    role,
  };
  return cachedWsAuth;
}

async function socketAuth(force = false) {
  if (!force && cachedWsAuth) return cachedWsAuth;
  if (force) cachedWsAuth = null;
  return fetchWsAuth();
}

function waitForSocketConnect(socket: Socket, timeoutMs = 12_000): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      reject(new Error('WebSocket connection timed out'));
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timer);
      socket.off('connect_error', onError);
      resolve();
    };
    const onError = (err: Error) => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      reject(err);
    };
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    socket.connect();
  });
}

/** Fetch JWT auth and connect the proctoring namespace (for monitoring or camera frames). */
export async function connectProctoringSocket(): Promise<Socket | null> {
  const url = getWsUrl();
  if (!url) return null;
  const auth = await socketAuth(true);
  const socket = getProctoringSocket();
  if (!socket || !auth?.token) return null;
  applySocketAuth(socket, auth);
  try {
    await waitForSocketConnect(socket);
  } catch {
    cachedWsAuth = null;
    const retryAuth = await socketAuth(true);
    if (!retryAuth?.token) return null;
    applySocketAuth(socket, retryAuth);
    await waitForSocketConnect(socket);
  }
  return socket;
}

/** Fetch JWT auth and connect the exam namespace. */
export async function connectExamSocket(): Promise<Socket | null> {
  const url = getWsUrl();
  if (!url) return null;
  const auth = await socketAuth(true);
  const socket = getExamSocket();
  if (!socket || !auth?.token) return null;
  applySocketAuth(socket, auth);
  try {
    await waitForSocketConnect(socket);
  } catch {
    cachedWsAuth = null;
    const retryAuth = await socketAuth(true);
    if (!retryAuth?.token) return null;
    applySocketAuth(socket, retryAuth);
    await waitForSocketConnect(socket);
  }
  return socket;
}

function applySocketAuth(socket: Socket, auth: typeof cachedWsAuth) {
  if (!auth) return;
  socket.auth = auth;
}

export function isWsEnabled(): boolean {
  return Boolean(getWsUrl());
}

export function getProctoringSocket(): Socket | null {
  const url = getWsUrl();
  if (!url) return null;
  if (proctoringSocket) {
    void socketAuth().then((auth) => applySocketAuth(proctoringSocket!, auth));
    return proctoringSocket;
  }

  proctoringSocket = io(`${url}/proctoring`, {
    auth: { token: '', tenantId: 'default', role: 'admin' },
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
  });

  proctoringSocket.on('connect_error', () => {
    cachedWsAuth = null;
    void socketAuth().then((auth) => applySocketAuth(proctoringSocket!, auth));
  });

  void socketAuth().then((auth) => applySocketAuth(proctoringSocket!, auth));

  return proctoringSocket;
}

export function getExamSocket(): Socket | null {
  const url = getWsUrl();
  if (!url) return null;
  if (examSocket) {
    void socketAuth().then((auth) => applySocketAuth(examSocket!, auth));
    return examSocket;
  }

  examSocket = io(`${url}/exam`, {
    auth: { token: '', tenantId: 'default', role: 'candidate' },
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
  });

  examSocket.on('connect_error', () => {
    cachedWsAuth = null;
    void socketAuth().then((auth) => applySocketAuth(examSocket!, auth));
  });

  void socketAuth().then((auth) => applySocketAuth(examSocket!, auth));

  return examSocket;
}

export function disconnectExamSocket() {
  examSocket?.disconnect();
  examSocket = null;
}

export function disconnectSockets() {
  proctoringSocket?.disconnect();
  proctoringSocket = null;
  cachedWsAuth = null;
  disconnectExamSocket();
}

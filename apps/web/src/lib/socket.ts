import { io, Socket } from 'socket.io-client';

function getWsUrl(): string {
  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      const api = process.env.NEXT_PUBLIC_API_URL || '';
      if (api.includes(':8000')) return ''; // FastAPI has no Socket.IO
    }
  }
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;

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

async function fetchWsAuth() {
  const res = await fetch('/api/auth/ws-token', { credentials: 'include' });
  if (!res.ok) throw new Error('Not authenticated');
  const data = await res.json();
  const role = data.role || 'candidate';
  cachedWsAuth = {
    token: data.token as string,
    tenantId: (data.tenantId as string) || 'default',
    role,
  };
  return cachedWsAuth;
}

async function socketAuth() {
  if (cachedWsAuth) return cachedWsAuth;
  return fetchWsAuth();
}

function applySocketAuth(socket: Socket, auth: { token: string; tenantId: string; role: string }) {
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

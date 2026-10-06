import { NextRequest, NextResponse } from 'next/server';
import { fetchWithColdStartRetry } from '@/lib/cold-start-retry';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth-cookies';
import { isLocalApiProxyBase, resolveApiProxyBase } from '@/lib/api-proxy-base';

async function fetchUpstream(targetUrl: string, init: RequestInit): Promise<Response> {
  const apiBase = resolveApiProxyBase();
  if (isLocalApiProxyBase(apiBase)) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetch(targetUrl, { ...init, cache: 'no-store' });
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
    throw lastError;
  }
  return fetchWithColdStartRetry(targetUrl, init);
}

async function proxyRequest(req: NextRequest, pathSegments: string[]) {
  const path = pathSegments.join('/');
  const apiBase = resolveApiProxyBase();
  const targetUrl = `${apiBase}/api/v1/${path}${req.nextUrl.search}`;

  const contentType = req.headers.get('content-type') || '';
  const isMultipart = contentType.includes('multipart/form-data');

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection') return;
    if (lower === 'content-length' && isMultipart) return;
    headers.set(key, value);
  });

  const cookieAccessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  // Prefer HttpOnly cookie over client Authorization (stale Zustand tokens after redeploy).
  if (cookieAccessToken) {
    headers.set('authorization', `Bearer ${cookieAccessToken}`);
  } else if (!headers.has('authorization')) {
    // no cookie — forward client header if present
  }

  let requestBody: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (isMultipart) {
      // Re-parse and forward FormData so boundary matches body (arrayBuffer breaks uploads)
      headers.delete('content-type');
      requestBody = await req.formData();
    } else {
      requestBody = await req.text();
    }
  }

  let upstream: Response;
  try {
    upstream = await fetchUpstream(targetUrl, {
      method: req.method,
      headers,
      body: requestBody,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { message: 'API is waking up (free tier). Wait 30–60 seconds, then try again.' } },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) responseHeaders.set('content-type', upstreamContentType);
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) responseHeaders.set('content-disposition', disposition);

  const isBinary = upstreamContentType?.includes('application/pdf')
    || upstreamContentType?.includes('octet-stream')
    || disposition?.includes('inline')
    || disposition?.includes('attachment');

  const responseBody = isBinary ? await upstream.arrayBuffer() : await upstream.text();

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const maxDuration = 60;

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

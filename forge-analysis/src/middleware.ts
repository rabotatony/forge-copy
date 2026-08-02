// ============================================================
// Forge — middleware (rate limiting)
// ============================================================
// Applies a sliding-window rate limit to API routes to prevent abuse.
// Static assets and non-API routes are passed through.
//
// Limits:
//   • API routes: 100 requests per minute per IP
//   • Upload route: 10 requests per minute per IP
//   • Trigger routes: 30 requests per minute per IP
// ============================================================
import { NextResponse, type NextRequest } from 'next/server';

// In-memory sliding-window rate limiter (per-server, per-IP).
// For multi-instance deployments, replace with Redis.
const windows = new Map<string, number[]>();
const WINDOW_MS = 60_000; // 1 minute

function rateLimit(key: string, maxRequests: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = windows.get(key) ?? [];
  // Drop timestamps outside the window.
  timestamps = timestamps.filter((t) => t > cutoff);
  if (timestamps.length >= maxRequests) {
    return false; // rate limited
  }
  timestamps.push(now);
  windows.set(key, timestamps);
  return true; // allowed
}

// Clean up old entries periodically (every 5 minutes).
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60_000) return;
  lastCleanup = now;
  const cutoff = now - WINDOW_MS;
  for (const [key, timestamps] of windows.entries()) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, filtered);
    }
  }
}

export function middleware(request: NextRequest): NextResponse {
  cleanup();

  const { pathname } = request.nextUrl;

  // Only rate-limit API routes.
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Get client IP (respect X-Forwarded-For from gateway).
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown';

  // Different limits for different route types.
  let limit = 200; // default: 200/min
  if (pathname.includes('/upload')) {
    limit = 50; // uploads: 50/min
  } else if (pathname.includes('/clone-repo')) {
    limit = 20; // git clone: 20/min (heavy)
  } else if (pathname.includes('/triggers/')) {
    limit = 60; // triggers: 60/min
  } else if (pathname.includes('/ai-assistant') || pathname.includes('/auto-script') || pathname.includes('/generate-script') || pathname.includes('/insights')) {
    limit = 30; // AI/LLM endpoints: 30/min
  }

  const key = `${ip}:${pathname.split('/').slice(0, 4).join('/')}`;
  if (!rateLimit(key, limit)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please slow down.' },
      {
        status: 429,
        headers: {
          'retry-after': '60',
          'x-ratelimit-limit': String(limit),
          'x-ratelimit-remaining': '0',
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set('x-ratelimit-limit', String(limit));
  return response;
}

export const config = {
  // Only run middleware on API routes.
  matcher: ['/api/:path*'],
};

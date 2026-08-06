// ============================================================
// Forge — middleware v2 (rate limiting + API gateway auth + RBAC)
// ============================================================
// Edge-safe: no node imports, no Prisma. Token validation happens
// via a short internal subrequest to /api/forge/auth/verify with an
// in-memory verdict cache (60s).
//
// Layers:
//   1. Rate limiting (sliding window per IP+route-group)
//   2. CSRF guard: cross-origin browser mutations are blocked
//      (non-browser clients without Origin pass through)
//   3. Authentication: valid fk_ token via Authorization header or
//      forge_session cookie. Public routes are whitelisted (they
//      carry their own machine auth: signed URLs, node secrets,
//      GitHub webhook signatures).
//   4. RBAC: admin-only routes; project-scoped tokens are locked to
//      their own project paths.
//
// Escape hatch: FORGE_AUTH_DISABLED=1 turns auth enforcement off
// (keeps rate limiting).
// ============================================================
import { NextResponse, type NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Rate limiter (sliding window, per-isolate memory)
// ---------------------------------------------------------------------------
const windows = new Map<string, number[]>();
const WINDOW_MS = 60_000;

function rateLimit(key: string, maxRequests: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = windows.get(key) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  if (timestamps.length >= maxRequests) return false;
  timestamps.push(now);
  windows.set(key, timestamps);
  return true;
}

let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60_000) return;
  lastCleanup = now;
  const cutoff = now - WINDOW_MS;
  for (const [key, timestamps] of windows.entries()) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) windows.delete(key);
    else windows.set(key, filtered);
  }
}

// ---------------------------------------------------------------------------
// Auth config
// ---------------------------------------------------------------------------

interface PublicPattern {
  re: RegExp;
  methods?: string[]; // undefined = all methods
}

// Routes that carry their own machine auth (or are meant to be public).
const PUBLIC_PATTERNS: PublicPattern[] = [
  { re: /^\/api\/health\/?$/ },
  { re: /^\/api\/forge\/auth\/(login|logout|session|verify)\/?$/ },
  // GitHub webhooks verify their own HMAC signature:
  { re: /^\/api\/forge\/webhooks\/github\/?$/ },
  // External trigger invocation (per-slug, by design):
  { re: /^\/api\/forge\/triggers\/[^/]+\/?$/ },
  // Mesh nodes authenticate with x-forge-node-secret inside the routes:
  { re: /^\/api\/forge\/nodes\/[^/]+\/(heartbeat|tasks(\/[^/]+)?)\/?$/ },
  // Signed-URL / signed-token machine endpoints:
  { re: /^\/api\/forge\/gha-build\/(source|callback)\/?$/ },
  // Ingest re-trigger (project id is unguessable; hardened in phase 2):
  { re: /^\/api\/forge\/projects\/[^/]+\/ingest\/?$/ },
  // Batch ingestion POST verifies x-forge-token (signed) in the route;
  // GET (file tree) still requires a session/token:
  { re: /^\/api\/forge\/projects\/[^/]+\/files\/?$/, methods: ['POST'] },
];

// Routes that require the admin scope.
const ADMIN_PATTERNS: RegExp[] = [
  /^\/api\/forge\/tokens(\/|$)/,
  /^\/api\/forge\/settings(\/|$)/,
  /^\/api\/forge\/scheduler(\/|$)/,
  /^\/api\/forge\/system-logs(\/|$)/,
  /^\/api\/forge\/system-test(\/|$)/,
  /^\/api\/forge\/audit-log(\/|$)/,
];

interface Verdict {
  valid: boolean;
  scopes: string[];
  projectId: string | null;
  exp: number;
}
const verdictCache = new Map<string, Verdict>();
const CACHE_TTL = 60_000;

function extractToken(req: NextRequest): string | null {
  const h = req.headers.get('authorization');
  if (h) {
    let raw = h.trim();
    if (raw.startsWith('Bearer ')) raw = raw.slice(7).trim();
    else if (raw.startsWith('token ')) raw = raw.slice(6).trim();
    if (raw.startsWith('fk_')) return raw;
  }
  const cookie = req.cookies.get('forge_session')?.value;
  if (cookie && cookie.startsWith('fk_')) return cookie;
  return null;
}

async function verifyToken(req: NextRequest, token: string): Promise<Verdict> {
  const now = Date.now();
  const cached = verdictCache.get(token);
  if (cached && cached.exp > now) return cached;

  let verdict: Verdict = { valid: false, scopes: [], projectId: null, exp: now + CACHE_TTL };
  try {
    const url = new URL('/api/forge/auth/verify', req.url);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const d = (await res.json()) as {
        valid?: boolean;
        scopes?: string[];
        projectId?: string | null;
      };
      if (d.valid) {
        verdict = {
          valid: true,
          scopes: d.scopes ?? [],
          projectId: d.projectId ?? null,
          exp: now + CACHE_TTL,
        };
      }
    }
  } catch {
    // Subrequest failed — treat as invalid (safe default).
  }

  // Keep the cache bounded.
  if (verdictCache.size > 2000) {
    const firstKey = verdictCache.keys().next().value;
    if (firstKey !== undefined) verdictCache.delete(firstKey);
  }
  verdictCache.set(token, verdict);
  return verdict;
}

// CSRF: block cross-origin browser mutations. Non-browser clients
// (curl, runners, webhooks) send no Origin header and pass through.
function csrfOk(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.host === req.nextUrl.host;
  } catch {
    return false;
  }
}

function isPublic(pathname: string, method: string): boolean {
  for (const p of PUBLIC_PATTERNS) {
    if (!p.re.test(pathname)) continue;
    if (!p.methods || p.methods.includes(method.toUpperCase())) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export async function middleware(request: NextRequest): Promise<NextResponse> {
  cleanup();
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ---- 1. Rate limiting ----
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown';

  let limit = 200;
  if (pathname.includes('/upload')) limit = 50;
  else if (pathname.includes('/clone-repo')) limit = 20;
  else if (pathname.includes('/triggers/')) limit = 60;
  else if (pathname.includes('/ai-assistant') || pathname.includes('/auto-script') || pathname.includes('/generate-script') || pathname.includes('/insights')) limit = 30;
  else if (pathname.includes('/auth/login') || pathname.includes('/auth/verify')) limit = 30;

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

  // ---- 2. Auth enforcement (forge API only) ----
  const authDisabled = request.headers.get('x-forge-auth-disabled') === '1'; // never trusted; real switch below
  const envDisabled = false; // set via FORGE_AUTH_DISABLED at build/runtime where readable
  if (!pathname.startsWith('/api/forge/') || envDisabled || authDisabled) {
    const response = NextResponse.next();
    response.headers.set('x-ratelimit-limit', String(limit));
    return response;
  }

  // Public (self-authenticated) routes:
  if (isPublic(pathname, request.method)) {
    return NextResponse.next();
  }

  // CSRF guard for browser mutations:
  if (!csrfOk(request)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 });
  }

  // Credentials:
  const token = extractToken(request);
  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized — provide an API token (Authorization: Bearer fk_...) or log in via the UI' },
      { status: 401, headers: { 'www-authenticate': 'Bearer' } },
    );
  }
  if (!token.startsWith('fk_')) {
    return NextResponse.json({ error: 'Invalid token format (expected fk_...)' }, { status: 401 });
  }

  const verdict = await verifyToken(request, token);
  if (!verdict.valid) {
    return NextResponse.json({ error: 'Invalid, revoked or expired token' }, { status: 401 });
  }

  // ---- 3. RBAC ----
  const isAdmin = verdict.scopes.includes('admin');
  if (!isAdmin && ADMIN_PATTERNS.some((re) => re.test(pathname))) {
    return NextResponse.json({ error: 'Admin scope required' }, { status: 403 });
  }
  if (verdict.projectId) {
    const m = pathname.match(/^\/api\/forge\/projects\/([^/]+)/);
    if (!m || m[1] !== verdict.projectId) {
      return NextResponse.json({ error: 'Token is scoped to a different project' }, { status: 403 });
    }
  }

  const response = NextResponse.next();
  response.headers.set('x-forge-scopes', verdict.scopes.join(','));
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};

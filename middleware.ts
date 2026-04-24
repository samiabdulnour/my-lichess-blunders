import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CORS middleware for `/api/*` routes.
 *
 * ── Why we need this ──
 * The web deployment serves the frontend and the API from the same origin,
 * so the browser never triggers a preflight. The Capacitor-wrapped iOS
 * build, on the other hand, loads the static frontend from a
 * `capacitor://localhost` origin and then calls `https://…onrender.com/api/…`
 * — which is cross-origin. Without CORS headers, Safari's WebKit blocks
 * the request.
 *
 * ── Safety ──
 * The existing `/api/*` endpoints are unauthenticated read endpoints (seed
 * puzzle list) and compute-bound stream endpoints (Lichess import + PGN
 * analysis) that only operate on the username passed in the request body.
 * There are no secrets to protect, no session cookies to leak, and no
 * credentialed requests — so a permissive `*` origin is fine here. If we
 * ever add auth, swap the wildcard for an explicit allowlist of the
 * Capacitor origin(s).
 */
export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '*';

  // Preflight — respond immediately with the allow headers.
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  // Non-preflight: let the route run, then layer on the headers.
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    res.headers.set(k, v);
  }
  return res;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * Scope the middleware to the API only — we don't want to pay the cost
 * on every HTML / static-asset request.
 */
export const config = {
  matcher: '/api/:path*',
};

/**
 * Resolve a `/api/...` path into a fully qualified URL.
 *
 * ── Why this exists ──
 * On the Render web deployment, the frontend and the API are same-origin,
 * so every `fetch('/api/puzzles')` call just works. When the app is
 * statically bundled into the iOS Capacitor shell, though, the frontend
 * loads from a `capacitor://` origin (or a local file://) and those
 * same relative URLs would 404 — there's no backend bundled inside the
 * iPhone app. We need to point them at the live Render deployment.
 *
 * The `NEXT_PUBLIC_API_BASE` env var drives the switch:
 *   · unset / empty  → same-origin (current web behavior, what Render uses)
 *   · "https://x.onrender.com" → prepended to every API call (iOS build)
 *
 * Because the var is prefixed with `NEXT_PUBLIC_`, Next.js inlines it at
 * build time, so the static export shipped to Capacitor has the URL
 * baked in.
 */
export function apiUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE ?? '').replace(/\/$/, '');
  return base + path;
}

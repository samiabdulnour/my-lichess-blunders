/** @type {import('next').NextConfig} */

/**
 * Two-mode build:
 *
 *   · default (npm run build)  — full Next.js build with API routes.
 *     This is what Render deploys: SSR + /api/* runs as Node handlers.
 *
 *   · static export (BUILD_TARGET=static)  — writes a purely static
 *     frontend to `out/`. No API routes are included; the static frontend
 *     calls `NEXT_PUBLIC_API_BASE` at runtime instead. This is what the
 *     Capacitor iOS build bundles into the app.
 *
 * Image optimization is disabled for the static export because the
 * optimizer is a runtime server feature, and we have no Next server on
 * the iOS side.
 */
const isStatic = process.env.BUILD_TARGET === 'static';

const nextConfig = {
  reactStrictMode: true,
  ...(isStatic
    ? {
        output: 'export',
        images: { unoptimized: true },
        // Capacitor serves from a local file:// origin where directory-style
        // paths don't auto-resolve to index.html — trailingSlash makes every
        // route emit its own directory + index.html so paths like /settings
        // still work inside the WebView.
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the iOS shell.
 *
 * `webDir: 'out'` points at the static export produced by
 * `npm run build:static` — Capacitor copies that into
 * `ios/App/App/public/` on every `cap sync`.
 *
 * `backgroundColor` matches the terminal-green theme so the brief
 * flash between the launch screen and the WebView paint isn't jarring.
 *
 * The iOS section's `contentInset: 'always'` stops the WebView's
 * scrollable content from sliding under the status bar / home
 * indicator — important for the fullscreen terminal look.
 */
const config: CapacitorConfig = {
  appId: 'com.samiabdulnour.myblunders',
  appName: 'My Blunders',
  webDir: 'out',
  backgroundColor: '#2da66a',
  ios: {
    contentInset: 'always',
  },
};

export default config;

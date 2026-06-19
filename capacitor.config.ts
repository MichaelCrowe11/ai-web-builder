import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the live production web app (https://ai-webbuilder.com) in a
 * native iOS shell. We deliberately use `server.url` rather than bundling the
 * Vite build because the app is server-coupled: auth (passport/express-session),
 * Stripe checkout, and the Anthropic generation calls all live on the Express
 * backend. A bundled static client would have no co-located API to talk to.
 *
 * `webDir` (capacitor/www) is a tiny branded offline fallback that only paints
 * when the device launches without network — it is NOT the real app.
 */
const config: CapacitorConfig = {
  appId: 'com.crowelogic.aiwebbuilder',
  appName: 'AI Web Builder',
  webDir: 'capacitor/www',
  server: {
    url: 'https://ai-webbuilder.com',
    cleartext: false,
    // Keep the app's own domains inside the in-app webview. Anything else
    // (e.g. Stripe Checkout, OAuth) falls through to the system browser, which
    // is the safer pattern for external auth/payment redirect flows.
    allowNavigation: ['ai-webbuilder.com', '*.ai-webbuilder.com'],
  },
  ios: {
    // Let content extend under the status bar / home indicator; the web app
    // handles its own safe-area insets via env(safe-area-inset-*).
    contentInset: 'never',
    backgroundColor: '#0b0b0c',
    // Distinct UA substring so the backend can detect the native shell if it
    // ever needs to (e.g. hide web-only upsells to respect App Store rules).
    appendUserAgent: 'AIWebBuilder-iOS',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0b0b0c',
      showSpinner: false,
      splashImmersive: false,
    },
  },
};

export default config;

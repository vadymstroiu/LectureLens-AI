import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

declare global {
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  }
}

interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  recaptchaSiteKey: string;
  appCheckDebugToken: string;
}

const REQUIRED_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

let cachedApp: FirebaseApp | null = null;
let cachedAppCheck: AppCheck | null = null;
let cachedAi: AI | null = null;

function readEnvConfig(): FirebaseEnvConfig {
  const env = import.meta.env;
  return {
    apiKey: (env.VITE_FIREBASE_API_KEY ?? '').trim(),
    authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim(),
    projectId: (env.VITE_FIREBASE_PROJECT_ID ?? '').trim(),
    storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim(),
    messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim(),
    appId: (env.VITE_FIREBASE_APP_ID ?? '').trim(),
    recaptchaSiteKey: (env.VITE_FIREBASE_RECAPTCHA_SITE_KEY ?? '').trim(),
    appCheckDebugToken: (env.VITE_APPCHECK_DEBUG_TOKEN ?? '').trim(),
  };
}

export function getMissingFirebaseEnvVars(): string[] {
  const env = import.meta.env as Record<string, string | undefined>;
  return REQUIRED_ENV_KEYS.filter((key) => {
    const value = (env[key] ?? '').trim();
    return !value || value.startsWith('your_');
  });
}

export function isFirebaseConfigured(): boolean {
  return getMissingFirebaseEnvVars().length === 0;
}

function assertSidePanelDocumentContext(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error(
      'Firebase AI Logic must run inside the Chrome Side Panel document context, not a service worker.',
    );
  }
}

function configureAppCheckDebugToken(debugTokenValue: string): void {
  if (!debugTokenValue) return;

  const normalized: boolean | string =
    debugTokenValue.toLowerCase() === 'true' ? true : debugTokenValue;
  (self as unknown as Window).FIREBASE_APPCHECK_DEBUG_TOKEN = normalized;
}

export function getFirebaseApp(): FirebaseApp {
  assertSidePanelDocumentContext();

  if (cachedApp) return cachedApp;

  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0];
    return cachedApp;
  }

  const missing = getMissingFirebaseEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase configuration (${missing.join(', ')}). Copy .env.example to .env and rebuild.`,
    );
  }

  const cfg = readEnvConfig();
  cachedApp = initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain || undefined,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket || undefined,
    messagingSenderId: cfg.messagingSenderId || undefined,
    appId: cfg.appId,
  });

  return cachedApp;
}

export function ensureFirebaseAppCheck(app: FirebaseApp): AppCheck | null {
  if (cachedAppCheck) return cachedAppCheck;

  const cfg = readEnvConfig();
  if (cfg.appCheckDebugToken) {
    configureAppCheckDebugToken(cfg.appCheckDebugToken);
  }

  if (cfg.recaptchaSiteKey || cfg.appCheckDebugToken) {
    const providerKey = cfg.recaptchaSiteKey || 'debug-appcheck-site-key';
    cachedAppCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(providerKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  return cachedAppCheck;
}

export function getFirebaseAI(): AI {
  assertSidePanelDocumentContext();

  if (cachedAi) return cachedAi;

  const app = getFirebaseApp();
  ensureFirebaseAppCheck(app);
  cachedAi = getAI(app, { backend: new GoogleAIBackend() });
  return cachedAi;
}

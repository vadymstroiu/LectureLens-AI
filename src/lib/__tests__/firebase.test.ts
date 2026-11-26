import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';

const mocks = vi.hoisted(() => {
  const initializeAppCheck = vi.fn(() => ({ app: { name: '[DEFAULT]' } }));
  const CustomProvider = vi.fn().mockImplementation((opts: unknown) => ({
    kind: 'CustomProvider',
    opts,
  }));
  const ReCaptchaV3Provider = vi.fn().mockImplementation((siteKey: string) => ({
    kind: 'ReCaptchaV3Provider',
    siteKey,
  }));
  return {
    initializeAppCheck,
    CustomProvider,
    ReCaptchaV3Provider,
  };
});

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  CustomProvider: mocks.CustomProvider,
  ReCaptchaV3Provider: mocks.ReCaptchaV3Provider,
}));

const FAKE_APP = { name: '[DEFAULT]' } as unknown as FirebaseApp;

describe('Firebase App Check initialization in MV3 Side Panel', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.initializeAppCheck.mockClear();
    mocks.CustomProvider.mockClear();
    mocks.ReCaptchaV3Provider.mockClear();
    delete (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown })
      .FIREBASE_APPCHECK_DEBUG_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalWindow !== undefined) {
      vi.stubGlobal('window', originalWindow);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('uses CustomProvider instead of ReCaptchaV3Provider when VITE_APPCHECK_DEBUG_TOKEN is set', async () => {
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'true');
    vi.stubEnv('VITE_FIREBASE_RECAPTCHA_SITE_KEY', '6Le-test-site-key');
    vi.stubGlobal('window', {
      location: { protocol: 'chrome-extension:' },
    });

    const { ensureFirebaseAppCheck, resetFirebaseCacheForTesting } = await import(
      '../firebase'
    );
    resetFirebaseCacheForTesting();

    const appCheck = ensureFirebaseAppCheck(FAKE_APP);

    expect(appCheck).not.toBeNull();
    expect(mocks.CustomProvider).toHaveBeenCalledTimes(1);
    expect(mocks.ReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mocks.initializeAppCheck).toHaveBeenCalledWith(
      FAKE_APP,
      expect.objectContaining({
        isTokenAutoRefreshEnabled: true,
      }),
    );
    expect(
      (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown })
        .FIREBASE_APPCHECK_DEBUG_TOKEN,
    ).toBe(true);
  });

  it('skips ReCaptchaV3Provider inside chrome-extension:// pages when no debug token is configured', async () => {
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', '');
    vi.stubEnv('VITE_FIREBASE_RECAPTCHA_SITE_KEY', '6Le-test-site-key');
    vi.stubGlobal('window', {
      location: { protocol: 'chrome-extension:' },
    });

    const { ensureFirebaseAppCheck, resetFirebaseCacheForTesting } = await import(
      '../firebase'
    );
    resetFirebaseCacheForTesting();

    const appCheck = ensureFirebaseAppCheck(FAKE_APP);

    expect(appCheck).toBeNull();
    expect(mocks.ReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mocks.CustomProvider).not.toHaveBeenCalled();
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
  });

  it('uses ReCaptchaV3Provider on standard HTTPS web origins when debug token is absent', async () => {
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', '');
    vi.stubEnv('VITE_FIREBASE_RECAPTCHA_SITE_KEY', '6Le-web-site-key');
    vi.stubGlobal('window', {
      location: { protocol: 'https:' },
    });

    const { ensureFirebaseAppCheck, resetFirebaseCacheForTesting } = await import(
      '../firebase'
    );
    resetFirebaseCacheForTesting();

    const appCheck = ensureFirebaseAppCheck(FAKE_APP);

    expect(appCheck).not.toBeNull();
    expect(mocks.ReCaptchaV3Provider).toHaveBeenCalledWith('6Le-web-site-key');
    expect(mocks.CustomProvider).not.toHaveBeenCalled();
  });
});

import type { HybridRoutingPolicy, LectureSession } from '../types/lecture';

const SESSION_PREFIX = 'lecturelens:session:';
const LAST_SOURCE_KEY = 'lecturelens:lastSourceId';
const PREFS_KEY = 'lecturelens:prefs';

export interface UserPreferences {
  policy: HybridRoutingPolicy;
  theme: 'light' | 'dark';
}

const DEFAULT_PREFS: UserPreferences = {
  policy: 'hybrid',
  theme: 'dark',
};

function getChromeStorage(): chrome.storage.LocalStorageArea | null {
  if (
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    chrome.storage.local
  ) {
    return chrome.storage.local;
  }
  return null;
}

export async function loadSession(
  sourceId: string,
): Promise<LectureSession | null> {
  const storage = getChromeStorage();
  if (!storage || !sourceId) return null;

  const key = `${SESSION_PREFIX}${sourceId}`;
  const result = await storage.get(key);
  const candidate = result[key] as LectureSession | undefined;
  return candidate ?? null;
}

export async function saveSession(session: LectureSession): Promise<void> {
  const storage = getChromeStorage();
  if (!storage || !session.sourceId) return;

  const key = `${SESSION_PREFIX}${session.sourceId}`;
  await storage.set({
    [key]: session,
    [LAST_SOURCE_KEY]: session.sourceId,
  });
}

export async function loadLastActiveSession(): Promise<LectureSession | null> {
  const storage = getChromeStorage();
  if (!storage) return null;

  const meta = await storage.get(LAST_SOURCE_KEY);
  const lastId = meta[LAST_SOURCE_KEY] as string | undefined;
  if (!lastId) return null;

  return loadSession(lastId);
}

export async function loadPreferences(): Promise<UserPreferences> {
  const storage = getChromeStorage();
  if (!storage) return DEFAULT_PREFS;

  const result = await storage.get(PREFS_KEY);
  const stored = result[PREFS_KEY] as Partial<UserPreferences> | undefined;
  return {
    policy: stored?.policy === 'local-only' ? 'local-only' : 'hybrid',
    theme: stored?.theme === 'light' ? 'light' : 'dark',
  };
}

export async function savePreferences(prefs: UserPreferences): Promise<void> {
  const storage = getChromeStorage();
  if (!storage) return;
  await storage.set({ [PREFS_KEY]: prefs });
}

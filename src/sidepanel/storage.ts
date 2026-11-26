import { normalizeTimestampFields } from '../content/youtubeTranscriptParser';
import type { HybridRoutingPolicy, LectureSession } from '../types/lecture';

const SESSION_PREFIX = 'lecturelens:session:';
const LAST_SOURCE_KEY = 'lecturelens:lastSourceId';
const PREFS_KEY = 'lecturelens:prefs';
const DEFAULT_LOCAL_QUOTA_BYTES = 10 * 1024 * 1024;

/**
 * User-configurable Side Panel preferences persisted per Chrome user profile.
 */
export interface UserPreferences {
  policy: HybridRoutingPolicy;
  theme: 'light' | 'dark';
  autoGenerateOnCapture: boolean;
}

/**
 * Local storage capacity summary for the current Chrome user profile.
 */
export interface StorageUsageSummary {
  sessionCount: number;
  bytesInUse: number | null;
  quotaBytes: number;
}

const DEFAULT_PREFS: UserPreferences = {
  policy: 'hybrid',
  theme: 'dark',
  autoGenerateOnCapture: true,
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

function normalizeSession(raw: LectureSession): LectureSession {
  const normalizedNotes = raw.notes
    ? {
        ...raw.notes,
        takeaways: Array.isArray(raw.notes.takeaways)
          ? raw.notes.takeaways
              .map((item) => normalizeTimestampFields(item))
              .sort((a, b) => a.startSeconds - b.startSeconds)
          : [],
        definitions: Array.isArray(raw.notes.definitions)
          ? raw.notes.definitions
              .map((item) => normalizeTimestampFields(item))
              .sort((a, b) => a.startSeconds - b.startSeconds)
          : [],
      }
    : undefined;

  const normalizedFlashcards = raw.flashcards
    ? {
        cards: Array.isArray(raw.flashcards.cards)
          ? raw.flashcards.cards
              .map((card) => normalizeTimestampFields(card))
              .sort((a, b) => a.startSeconds - b.startSeconds)
          : [],
      }
    : undefined;

  const normalizedQuiz = raw.quiz
    ? {
        questions: Array.isArray(raw.quiz.questions)
          ? raw.quiz.questions
              .map((q) => normalizeTimestampFields(q))
              .sort((a, b) => a.startSeconds - b.startSeconds)
          : [],
      }
    : undefined;

  return {
    ...raw,
    ...(normalizedNotes ? { notes: normalizedNotes } : {}),
    ...(normalizedFlashcards ? { flashcards: normalizedFlashcards } : {}),
    ...(normalizedQuiz ? { quiz: normalizedQuiz } : {}),
    masteredCardIds: Array.isArray(raw.masteredCardIds)
      ? raw.masteredCardIds
      : [],
    quizAnswers:
      raw.quizAnswers && typeof raw.quizAnswers === 'object'
        ? raw.quizAnswers
        : {},
    userNotes: Array.isArray(raw.userNotes) ? raw.userNotes : [],
    telemetryHistory: Array.isArray(raw.telemetryHistory)
      ? raw.telemetryHistory
      : [],
  };
}

/**
 * Loads a single lecture study session by `sourceId` from `chrome.storage.local`.
 */
export async function loadSession(
  sourceId: string,
): Promise<LectureSession | null> {
  const storage = getChromeStorage();
  if (!storage || !sourceId) return null;

  const key = `${SESSION_PREFIX}${sourceId}`;
  const result = await storage.get(key);
  const candidate = result[key] as LectureSession | undefined;
  return candidate ? normalizeSession(candidate) : null;
}

/**
 * Saves or updates a lecture study session in `chrome.storage.local` and marks
 * it as the most recently active session for this Chrome profile.
 */
export async function saveSession(session: LectureSession): Promise<void> {
  const storage = getChromeStorage();
  if (!storage || !session.sourceId) return;

  const key = `${SESSION_PREFIX}${session.sourceId}`;
  await storage.set({
    [key]: normalizeSession(session),
    [LAST_SOURCE_KEY]: session.sourceId,
  });
}

/**
 * Lists all saved study sessions in this Chrome user profile, newest first.
 */
export async function listSavedSessions(): Promise<LectureSession[]> {
  const storage = getChromeStorage();
  if (!storage) return [];

  const all = await storage.get(null);
  const sessions: LectureSession[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(SESSION_PREFIX)) continue;
    if (
      value &&
      typeof value === 'object' &&
      'sourceId' in value &&
      'content' in value
    ) {
      sessions.push(normalizeSession(value as LectureSession));
    }
  }

  return sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Deletes a saved study session from `chrome.storage.local`.
 */
export async function deleteSession(sourceId: string): Promise<void> {
  const storage = getChromeStorage();
  if (!storage || !sourceId) return;

  const key = `${SESSION_PREFIX}${sourceId}`;
  const meta = await storage.get(LAST_SOURCE_KEY);
  await storage.remove(key);
  if (meta[LAST_SOURCE_KEY] === sourceId) {
    await storage.remove(LAST_SOURCE_KEY);
  }
}

/**
 * Loads the most recently active study session on Side Panel open.
 */
export async function loadLastActiveSession(): Promise<LectureSession | null> {
  const storage = getChromeStorage();
  if (!storage) return null;

  const meta = await storage.get(LAST_SOURCE_KEY);
  const lastId = meta[LAST_SOURCE_KEY] as string | undefined;
  if (!lastId) return null;

  return loadSession(lastId);
}

/**
 * Returns local storage session count and byte usage for the active profile.
 */
export async function getStorageUsageSummary(): Promise<StorageUsageSummary> {
  const storage = getChromeStorage();
  const sessions = await listSavedSessions();
  if (!storage) {
    return {
      sessionCount: sessions.length,
      bytesInUse: null,
      quotaBytes: DEFAULT_LOCAL_QUOTA_BYTES,
    };
  }

  let bytesInUse: number | null = sessions.length === 0 ? 0 : null;
  try {
    if (sessions.length > 0 && typeof storage.getBytesInUse === 'function') {
      const sessionKeys = sessions.map((s) => `${SESSION_PREFIX}${s.sourceId}`);
      bytesInUse = await storage.getBytesInUse(sessionKeys);
    }
  } catch {
    bytesInUse = null;
  }

  return {
    sessionCount: sessions.length,
    bytesInUse,
    quotaBytes: storage.QUOTA_BYTES ?? DEFAULT_LOCAL_QUOTA_BYTES,
  };
}

/**
 * Loads persisted Side Panel preferences (`policy`, `theme`, `autoGenerateOnCapture`).
 */
export async function loadPreferences(): Promise<UserPreferences> {
  const storage = getChromeStorage();
  if (!storage) return DEFAULT_PREFS;

  const result = await storage.get(PREFS_KEY);
  const stored = result[PREFS_KEY] as Partial<UserPreferences> | undefined;
  return {
    policy: stored?.policy === 'local-only' ? 'local-only' : 'hybrid',
    theme: stored?.theme === 'light' ? 'light' : 'dark',
    autoGenerateOnCapture: stored?.autoGenerateOnCapture ?? true,
  };
}

/**
 * Persists Side Panel preferences in `chrome.storage.local`.
 */
export async function savePreferences(prefs: UserPreferences): Promise<void> {
  const storage = getChromeStorage();
  if (!storage) return;
  await storage.set({ [PREFS_KEY]: prefs });
}

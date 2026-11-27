import { afterEach, describe, expect, it } from 'vitest';
import type { LectureSession } from '../../types/lecture';
import {
  deleteSession,
  getStorageUsageSummary,
  listSavedSessions,
  loadLastActiveSession,
  loadPreferences,
  loadSession,
  savePreferences,
  saveSession,
} from '../storage';

function installMockLocalStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        QUOTA_BYTES: 10 * 1024 * 1024,
        get: async (keys: string | string[] | null) => {
          if (keys === null) return { ...store };
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (k in store) out[k] = store[k];
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete store[k];
        },
        getBytesInUse: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) {
            return JSON.stringify(store).length;
          }
          const list = Array.isArray(keys) ? keys : [keys];
          if (list.length === 0) return 0;
          const subset: Record<string, unknown> = {};
          for (const k of list) {
            if (k in store) subset[k] = store[k];
          }
          return Object.keys(subset).length > 0
            ? JSON.stringify(subset).length
            : 0;
        },
      },
    },
  };
  return store;
}

describe('storage (local per-profile study history)', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('saves, lists newest-first, loads, and deletes sessions cleanly', async () => {
    installMockLocalStorage();

    const s1: LectureSession = {
      sourceId: 'yt:first',
      content: {
        sourceId: 'yt:first',
        sourceType: 'youtube',
        title: 'First Lecture',
        url: 'https://www.youtube.com/watch?v=first',
        segments: [],
        rawText: 'One',
        capturedAt: 1000,
      },
      masteredCardIds: [],
      quizAnswers: {},
      telemetryHistory: [],
      updatedAt: 1000,
    };

    const s2: LectureSession = {
      ...s1,
      sourceId: 'yt:second',
      content: {
        ...s1.content,
        sourceId: 'yt:second',
        title: 'Second Lecture',
        url: 'https://www.youtube.com/watch?v=second',
      },
      updatedAt: 5000,
    };

    await saveSession(s1);
    await saveSession(s2);

    const listed = await listSavedSessions();
    expect(listed.map((s) => s.sourceId)).toEqual(['yt:second', 'yt:first']);

    const active = await loadLastActiveSession();
    expect(active?.sourceId).toBe('yt:second');

    const usage = await getStorageUsageSummary();
    expect(usage.sessionCount).toBe(2);
    expect(usage.bytesInUse).toBeGreaterThan(0);

    await deleteSession('yt:second');
    expect(await loadSession('yt:second')).toBeNull();
    expect(await loadLastActiveSession()).toBeNull();
    expect((await listSavedSessions()).map((s) => s.sourceId)).toEqual([
      'yt:first',
    ]);

    await savePreferences({
      policy: 'hybrid',
      theme: 'dark',
      autoGenerateOnCapture: true,
    });
    await deleteSession('yt:first');
    const emptyUsage = await getStorageUsageSummary();
    expect(emptyUsage.sessionCount).toBe(0);
    expect(emptyUsage.bytesInUse).toBe(0);
  });

  it('normalizes legacy stored sessions missing userNotes or optional arrays', async () => {
    installMockLocalStorage({
      'lecturelens:session:legacy': {
        sourceId: 'legacy',
        content: {
          sourceId: 'legacy',
          sourceType: 'sample',
          title: 'Legacy Session',
          url: '',
          segments: [],
          rawText: 'Legacy text',
          capturedAt: 500,
        },
        updatedAt: 500,
      },
    });

    const loaded = await loadSession('legacy');
    expect(loaded).not.toBeNull();
    expect(loaded?.userNotes).toEqual([]);
    expect(loaded?.masteredCardIds).toEqual([]);
    expect(loaded?.quizAnswers).toEqual({});
    expect(loaded?.telemetryHistory).toEqual([]);
  });

  it('strips bracketed timestamps, repairs mismatched startSeconds, and sorts cached sessions chronologically', async () => {
    installMockLocalStorage({
      'lecturelens:session:cached-unsorted': {
        sourceId: 'cached-unsorted',
        content: {
          sourceId: 'cached-unsorted',
          sourceType: 'youtube',
          title: 'Cached Session',
          url: 'https://www.youtube.com/watch?v=abc',
          segments: [],
          rawText: 'Transcript',
          capturedAt: 500,
        },
        notes: {
          overview: 'Summary',
          takeaways: [
            {
              point: 'Later point with brackets and bad seconds',
              timestamp: '[12:36]',
              startSeconds: 12,
            },
            {
              point: 'Earlier point',
              timestamp: '05:33',
              startSeconds: 333,
            },
          ],
          definitions: [
            {
              term: 'Late term',
              definition: 'Desc',
              timestamp: '[14:00]',
              startSeconds: 14,
            },
            {
              term: 'Early term',
              definition: 'Desc',
              timestamp: '02:10',
              startSeconds: 130,
            },
          ],
        },
        updatedAt: 500,
      },
    });

    const loaded = await loadSession('cached-unsorted');
    expect(loaded?.notes?.takeaways).toEqual([
      { point: 'Earlier point', timestamp: '05:33', startSeconds: 333 },
      {
        point: 'Later point with brackets and bad seconds',
        timestamp: '12:36',
        startSeconds: 756,
      },
    ]);
    expect(loaded?.notes?.definitions.map((d) => d.timestamp)).toEqual([
      '02:10',
      '14:00',
    ]);
  });

  it('persists and loads user preferences including autoGenerateOnCapture', async () => {
    installMockLocalStorage();
    expect(await loadPreferences()).toEqual({
      policy: 'hybrid',
      theme: 'light',
      autoGenerateOnCapture: true,
    });

    await savePreferences({
      policy: 'local-only',
      theme: 'dark',
      autoGenerateOnCapture: false,
    });

    expect(await loadPreferences()).toEqual({
      policy: 'local-only',
      theme: 'dark',
      autoGenerateOnCapture: false,
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureYouTubeFromActiveTab,
  getCurrentYouTubeVideoTime,
  grabSelectionFromActiveTab,
  isYouTubeUrl,
  openSourceUrl,
  seekActiveYouTubeVideo,
  seekOrOpenVideo,
} from '../youtubeBridge';

describe('youtubeBridge', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('detects YouTube watch, short, live, and youtu.be URLs safely', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(isYouTubeUrl('https://youtu.be/abc123')).toBe(true);
    expect(isYouTubeUrl('https://youtube.com/shorts/short99')).toBe(true);
    expect(isYouTubeUrl('https://m.youtube.com/watch?v=abc123')).toBe(true);
    expect(isYouTubeUrl('https://example.com/article')).toBe(false);
    expect(isYouTubeUrl('not-a-url')).toBe(false);
    expect(isYouTubeUrl(undefined)).toBe(false);
  });

  it('returns an actionable error when the active tab is not YouTube', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 7, url: 'https://developer.chrome.com/docs/ai' },
        ]),
      },
    };

    const res = await captureYouTubeFromActiveTab();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('YouTube video page');
    }
  });

  it('captures transcript directly when content script listener responds', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      videoId: 'vid42',
      title: 'Hybrid AI Talk',
      url: 'https://www.youtube.com/watch?v=vid42',
      segments: [{ startSeconds: 5, timestamp: '00:05', text: 'Hello world' }],
    });

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 12, url: 'https://www.youtube.com/watch?v=vid42' },
        ]),
        sendMessage,
      },
    };

    const res = await captureYouTubeFromActiveTab();
    expect(sendMessage).toHaveBeenCalledWith(12, { type: 'CAPTURE_TRANSCRIPT' });
    expect(res).toEqual({
      ok: true,
      videoId: 'vid42',
      title: 'Hybrid AI Talk',
      url: 'https://www.youtube.com/watch?v=vid42',
      segments: [{ startSeconds: 5, timestamp: '00:05', text: 'Hello world' }],
    });
  });

  it('injects manifest content script and retries when pre-opened YouTube tab lacks listener', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockResolvedValueOnce({
        ok: true,
        videoId: 'vid99',
        title: 'Pre-opened Video',
        url: 'https://www.youtube.com/watch?v=vid99',
        segments: [{ startSeconds: 0, timestamp: '00:00', text: 'Intro' }],
      });
    const executeScript = vi.fn().mockResolvedValue([]);

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        getManifest: vi.fn().mockReturnValue({
          content_scripts: [{ js: ['assets/youtube.ts-loader.js'] }],
        }),
      },
      scripting: { executeScript },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 21, url: 'https://www.youtube.com/watch?v=vid99' },
        ]),
        sendMessage,
      },
    };

    const res = await captureYouTubeFromActiveTab({
      sleep: async () => undefined,
    });

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 21 },
      files: ['assets/youtube.ts-loader.js'],
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
  });

  it('seeks active YouTube video via SEEK_VIDEO message', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      currentTime: 135,
    });

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 5, url: 'https://www.youtube.com/watch?v=abc' },
        ]),
        sendMessage,
      },
    };

    const res = await seekActiveYouTubeVideo(135);
    expect(sendMessage).toHaveBeenCalledWith(5, {
      type: 'SEEK_VIDEO',
      startSeconds: 135,
    });
    expect(res).toEqual({ ok: true, currentTime: 135 });
  });

  it('seekOrOpenVideo seeks matching active tab, focuses existing tab, or opens new timestamped YouTube tab', async () => {
    const sourceUrl = 'https://www.youtube.com/watch?v=targetVid';

    // 1. Active tab matches target video -> seek in-place
    const sendMessageActive = vi.fn().mockResolvedValue({
      ok: true,
      currentTime: 90,
    });
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, url: 'https://www.youtube.com/watch?v=targetVid' },
        ]),
        sendMessage: sendMessageActive,
      },
    };
    const activeRes = await seekOrOpenVideo(sourceUrl, 90);
    expect(activeRes).toEqual({
      ok: true,
      action: 'seeked-active',
      currentTime: 90,
    });

    // 2. User is on another tab while target video is open in tab 9 -> focus & seek tab 9
    const updateTab = vi.fn().mockResolvedValue({});
    const sendMessageExisting = vi.fn().mockResolvedValue({
      ok: true,
      currentTime: 240,
    });
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi
          .fn()
          .mockResolvedValueOnce([{ id: 2, url: 'https://example.com/docs' }])
          .mockResolvedValueOnce([
            { id: 2, url: 'https://example.com/docs' },
            { id: 9, url: 'https://www.youtube.com/watch?v=targetVid&t=10s' },
          ]),
        update: updateTab,
        sendMessage: sendMessageExisting,
      },
    };
    const existingRes = await seekOrOpenVideo(sourceUrl, 240);
    expect(updateTab).toHaveBeenCalledWith(9, { active: true });
    expect(sendMessageExisting).toHaveBeenCalledWith(9, {
      type: 'SEEK_VIDEO',
      startSeconds: 240,
    });
    expect(existingRes).toEqual({
      ok: true,
      action: 'seeked-existing-tab',
      currentTime: 240,
    });

    // 3. User is watching a DIFFERENT YouTube video -> opens new tab at &t=300s (does not hijack)
    const createTab = vi.fn().mockResolvedValue({ id: 15 });
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi
          .fn()
          .mockResolvedValueOnce([
            { id: 3, url: 'https://www.youtube.com/watch?v=otherVid' },
          ])
          .mockResolvedValueOnce([
            { id: 3, url: 'https://www.youtube.com/watch?v=otherVid' },
          ]),
        create: createTab,
      },
    };
    const newTabRes = await seekOrOpenVideo(sourceUrl, 300);
    expect(createTab).toHaveBeenCalledWith({
      url: 'https://www.youtube.com/watch?v=targetVid&t=300s',
      active: true,
    });
    expect(newTabRes).toEqual({
      ok: true,
      action: 'opened-new-tab',
      url: 'https://www.youtube.com/watch?v=targetVid&t=300s',
    });
  });

  it('reads current playback time from matching YouTube tab via GET_VIDEO_TIME', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      currentSeconds: 185,
      timestamp: '03:05',
    });

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 11, url: 'https://www.youtube.com/watch?v=targetVid' },
        ]),
        sendMessage,
      },
    };

    const res = await getCurrentYouTubeVideoTime(
      'https://www.youtube.com/watch?v=targetVid',
    );
    expect(sendMessage).toHaveBeenCalledWith(11, { type: 'GET_VIDEO_TIME' });
    expect(res).toEqual({
      ok: true,
      currentSeconds: 185,
      timestamp: '03:05',
    });
  });

  it('openSourceUrl avoids duplicate tabs, focuses existing tabs, and pauses active YouTube before opening new tab', async () => {
    const rawUrl = 'https://www.youtube.com/watch?v=abc123&list=PL99&index=3';

    // 1. Already active -> does not open a duplicate tab
    const createNoop = vi.fn();
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, url: 'https://www.youtube.com/watch?v=abc123' },
        ]),
        create: createNoop,
      },
    };
    const alreadyRes = await openSourceUrl(rawUrl);
    expect(alreadyRes).toEqual({
      ok: true,
      action: 'already-active',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(createNoop).not.toHaveBeenCalled();

    // 2. Open in another tab -> pauses current YouTube tab and focuses matching tab
    const sendPause = vi.fn().mockResolvedValue({ ok: true });
    const updateTab = vi.fn().mockResolvedValue({});
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi
          .fn()
          .mockResolvedValueOnce([
            { id: 2, url: 'https://www.youtube.com/watch?v=otherVid' },
          ])
          .mockResolvedValueOnce([
            { id: 2, url: 'https://www.youtube.com/watch?v=otherVid' },
            { id: 8, url: 'https://www.youtube.com/watch?v=abc123' },
          ]),
        sendMessage: sendPause,
        update: updateTab,
      },
    };
    const focusRes = await openSourceUrl(rawUrl);
    expect(sendPause).toHaveBeenCalledWith(2, { type: 'PAUSE_VIDEO' });
    expect(updateTab).toHaveBeenCalledWith(8, { active: true });
    expect(focusRes).toEqual({
      ok: true,
      action: 'focused-existing-tab',
      url: 'https://www.youtube.com/watch?v=abc123',
    });

    // 3. Not open -> pauses current YouTube tab and opens clean canonical URL
    const sendPauseNew = vi.fn().mockResolvedValue({ ok: true });
    const createTab = vi.fn().mockResolvedValue({ id: 20 });
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi
          .fn()
          .mockResolvedValueOnce([
            { id: 4, url: 'https://www.youtube.com/watch?v=otherVid' },
          ])
          .mockResolvedValueOnce([
            { id: 4, url: 'https://www.youtube.com/watch?v=otherVid' },
          ]),
        sendMessage: sendPauseNew,
        create: createTab,
      },
    };
    const newTabRes = await openSourceUrl(rawUrl);
    expect(sendPauseNew).toHaveBeenCalledWith(4, { type: 'PAUSE_VIDEO' });
    expect(createTab).toHaveBeenCalledWith({
      url: 'https://www.youtube.com/watch?v=abc123',
      active: true,
    });
    expect(newTabRes).toEqual({
      ok: true,
      action: 'opened-new-tab',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
  });

  it('grabSelectionFromActiveTab requests optional_host_permissions for article sites and retries', async () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    const executeScript = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
        ),
      )
      .mockResolvedValueOnce([{ result: 'Highlighted Wikipedia text.' }]);
    const queryTabs = vi
      .fn()
      .mockResolvedValueOnce([{ id: 30 }])
      .mockResolvedValueOnce([
        {
          id: 30,
          url: 'https://en.wikipedia.org/wiki/Hybrid_AI',
          title: 'Hybrid AI - Wikipedia',
        },
      ]);

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: { query: queryTabs },
      scripting: { executeScript },
      permissions: { request: requestPermission },
    };

    const res = await grabSelectionFromActiveTab();
    expect(requestPermission).toHaveBeenCalledWith({
      origins: ['https://*/*', 'http://*/*'],
    });
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      ok: true,
      text: 'Highlighted Wikipedia text.',
      title: 'Hybrid AI - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Hybrid_AI',
    });
  });

  it('grabSelectionFromActiveTab handles denied permissions and internal chrome:// pages gracefully', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 31, url: 'chrome://extensions' },
        ]),
      },
      scripting: { executeScript: vi.fn() },
    };

    const internalRes = await grabSelectionFromActiveTab();
    expect(internalRes.ok).toBe(false);
    if (!internalRes.ok) {
      expect(internalRes.error).toContain('internal pages');
    }

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 32, url: 'https://en.wikipedia.org/wiki/Test' },
        ]),
      },
      scripting: {
        executeScript: vi
          .fn()
          .mockRejectedValue(new Error('Cannot access contents of the page')),
      },
      permissions: { request: vi.fn().mockResolvedValue(false) },
    };

    const deniedRes = await grabSelectionFromActiveTab();
    expect(deniedRes.ok).toBe(false);
    if (!deniedRes.ok) {
      expect(deniedRes.error).toContain('not granted');
    }
  });
});

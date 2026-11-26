import {
  buildYouTubeTimestampUrl,
  extractVideoId,
  formatTimestamp,
} from '../content/youtubeTranscriptParser';
import type {
  CaptureTranscriptResponse,
  ExtensionMessage,
  GetVideoTimeResponse,
  PauseVideoResponse,
  SeekVideoResponse,
} from '../types/lecture';

/**
 * Result of reading selected text from the active browser tab.
 */
export type GrabSelectionResult =
  | {
      ok: true;
      text: string;
      title: string;
      url: string;
    }
  | {
      ok: false;
      error: string;
      hint?: string;
    };

/**
 * Outcome of seeking or deep-linking to a YouTube lecture timestamp.
 */
export type SeekOrOpenResult =
  | {
      ok: true;
      action: 'seeked-active' | 'seeked-existing-tab' | 'opened-new-tab';
      currentTime?: number;
      url?: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Outcome of opening a saved lecture or article source URL.
 */
export type OpenSourceUrlResult =
  | {
      ok: true;
      action: 'already-active' | 'focused-existing-tab' | 'opened-new-tab';
      url: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Optional dependencies injected for deterministic unit testing.
 */
export interface YouTubeBridgeDeps {
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns the currently active browser tab in the focused window, or `null`
 * when Chrome tabs APIs are unavailable.
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

/**
 * Returns `true` when the given URL points to YouTube (`youtube.com` or `youtu.be`).
 */
export function isYouTubeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

/**
 * Normalizes a YouTube video URL into canonical `watch?v=...` form so opening
 * a past lecture avoids stale miniplayer or playlist side-effects.
 */
export function normalizeLectureUrl(rawUrl: string): string {
  const videoId = extractVideoId(rawUrl);
  if (!videoId) return rawUrl;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Ensures the compiled YouTube content script from the MV3 manifest is
 * injected into `tabId` (needed for tabs opened before extension install/reload).
 */
export async function ensureYouTubeContentScript(tabId: number): Promise<boolean> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime?.getManifest ||
    !chrome.scripting?.executeScript
  ) {
    return false;
  }

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  if (files.length === 0) {
    return false;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files,
  });
  return true;
}

/**
 * Sends a typed extension message to a YouTube tab, automatically injecting the
 * content script and retrying briefly if the listener is not yet attached.
 */
export async function sendYouTubeMessage<T>(
  tabId: number,
  tabUrl: string | undefined,
  message: ExtensionMessage,
  deps?: YouTubeBridgeDeps,
): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch (initialError) {
    if (!isYouTubeUrl(tabUrl)) {
      throw initialError;
    }

    const injected = await ensureYouTubeContentScript(tabId);
    if (!injected) {
      throw initialError;
    }

    const sleep = deps?.sleep ?? DEFAULT_SLEEP;
    let lastError: unknown = initialError;
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(150);
      try {
        return (await chrome.tabs.sendMessage(tabId, message)) as T;
      } catch (retryError) {
        lastError = retryError;
      }
    }

    throw lastError;
  }
}

/**
 * Best-effort pause on a playing YouTube tab before switching away so Chrome
 * does not trigger an unwanted Auto Picture-in-Picture mini-window.
 */
async function pauseTabYouTubeVideo(
  tabId: number,
  tabUrl: string | undefined,
  deps?: YouTubeBridgeDeps,
): Promise<void> {
  if (!isYouTubeUrl(tabUrl)) return;
  try {
    await sendYouTubeMessage<PauseVideoResponse>(
      tabId,
      tabUrl,
      { type: 'PAUSE_VIDEO' },
      deps,
    );
  } catch {
    // Non-fatal: never block navigation if pause fails
  }
}

/**
 * Captures a timestamped transcript from the active YouTube tab via the
 * `src/content/youtube.ts` content script.
 */
export async function captureYouTubeFromActiveTab(
  deps?: YouTubeBridgeDeps,
): Promise<CaptureTranscriptResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return {
      ok: false,
      error: 'No active browser tab detected.',
    };
  }

  if (!isYouTubeUrl(tab.url)) {
    return {
      ok: false,
      error:
        'Navigate to a YouTube video page (youtube.com/watch?v=...) to capture its transcript, or use Paste / Selected Text below.',
    };
  }

  try {
    return await sendYouTubeMessage<CaptureTranscriptResponse>(
      tab.id,
      tab.url,
      { type: 'CAPTURE_TRANSCRIPT' },
      deps,
    );
  } catch {
    return {
      ok: false,
      error:
        'Could not extract transcript from this YouTube tab. Refresh the video tab or paste text below.',
    };
  }
}

function getHttpOriginPattern(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return `${parsed.origin}/*`;
    }
    return null;
  } catch {
    return null;
  }
}

function isRestrictedBrowserUrl(url?: string): boolean {
  if (!url) return false;
  return /^(?:chrome|chrome-extension|edge|about|devtools|view-source):/i.test(
    url,
  );
}

async function readSelectionFromTab(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.getSelection()?.toString()?.trim() ?? '',
  });
  return (results[0]?.result as string | undefined) ?? '';
}

/**
 * Reads highlighted text from the active browser tab using `chrome.scripting`,
 * requesting site access via MV3 `optional_host_permissions` when needed.
 */
export async function grabSelectionFromActiveTab(): Promise<GrabSelectionResult> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return {
      ok: false,
      error: 'No active tab to read selection from.',
    };
  }

  if (isRestrictedBrowserUrl(tab.url)) {
    return {
      ok: false,
      error: 'Cannot read selection from browser internal pages.',
      hint: 'Switch to a regular http:// or https:// webpage, or paste text directly below.',
    };
  }

  try {
    const selected = await readSelectionFromTab(tab.id);
    if (!selected) {
      return {
        ok: false,
        error: 'No highlighted text found on the active page.',
        hint: 'Highlight an article paragraph on the page first, or paste text directly.',
      };
    }

    return {
      ok: true,
      text: selected,
      title: tab.title || 'Selected Web Excerpt',
      url: tab.url || '',
    };
  } catch (initialError) {
    if (typeof chrome !== 'undefined' && chrome.permissions?.request) {
      const originPattern = getHttpOriginPattern(tab.url);
      const originsToRequest = originPattern
        ? [originPattern]
        : ['https://*/*', 'http://*/*'];

      try {
        const granted = await chrome.permissions.request({
          origins: originsToRequest,
        });
        if (!granted) {
          return {
            ok: false,
            error: 'Permission to read highlighted text on this site was not granted.',
            hint: 'Click Allow when prompted, or paste text directly below.',
          };
        }

        const refreshedTab = (await getActiveTab()) ?? tab;
        if (isRestrictedBrowserUrl(refreshedTab.url)) {
          return {
            ok: false,
            error: 'Cannot read selection from browser internal pages.',
            hint: 'Switch to a regular http:// or https:// webpage, or paste text directly below.',
          };
        }

        const selectedAfterGrant = await readSelectionFromTab(
          refreshedTab.id ?? tab.id,
        );
        if (!selectedAfterGrant) {
          return {
            ok: false,
            error: 'No highlighted text found on the active page.',
            hint: 'Highlight an article paragraph on the page first, or paste text directly.',
          };
        }

        return {
          ok: true,
          text: selectedAfterGrant,
          title: refreshedTab.title || 'Selected Web Excerpt',
          url: refreshedTab.url || '',
        };
      } catch (retryError) {
        return {
          ok: false,
          error: 'Unable to read selection from this page.',
          hint:
            retryError instanceof Error
              ? retryError.message
              : String(retryError),
        };
      }
    }

    return {
      ok: false,
      error: 'Unable to read selection from this page.',
      hint:
        initialError instanceof Error
          ? initialError.message
          : String(initialError),
    };
  }
}

async function seekTabVideo(
  tabId: number,
  tabUrl: string | undefined,
  startSeconds: number,
  deps?: YouTubeBridgeDeps,
): Promise<SeekVideoResponse> {
  try {
    return await sendYouTubeMessage<SeekVideoResponse>(
      tabId,
      tabUrl,
      { type: 'SEEK_VIDEO', startSeconds },
      deps,
    );
  } catch {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sec: number) => {
          const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
          if (videos.length === 0) return null;

          let best: HTMLVideoElement | null = null;
          let bestScore = Number.NEGATIVE_INFINITY;
          for (const v of videos) {
            const rect = v.getBoundingClientRect();
            const isPreview = Boolean(
              v.closest('#inline-preview-player, ytd-video-preview'),
            );
            const isMain = Boolean(
              !isPreview &&
                (v.closest('#movie_player, ytd-player#ytd-player') ||
                  v.classList.contains('html5-main-video')),
            );
            let score = 0;
            if (isPreview) score -= 1000;
            if (rect.width < 20 || rect.height < 20) score -= 500;
            if (isMain) score += 400;
            if (Number.isFinite(v.duration) && v.duration > 0) score += 300;
            if (v.readyState >= 1) score += 150;
            if (!v.paused) score += 120;
            if (v.currentTime > 0) score += 80;
            if (score > bestScore) {
              bestScore = score;
              best = v;
            }
          }

          if (
            !best ||
            (best.readyState === 0 &&
              !(Number.isFinite(best.duration) && best.duration > 0))
          ) {
            return null;
          }

          const rawTarget = Math.max(0, sec);
          const safeTarget =
            Number.isFinite(best.duration) && best.duration > 0
              ? Math.min(rawTarget, Math.max(0, best.duration - 0.5))
              : rawTarget;
          best.currentTime = safeTarget;
          void best.play().catch(() => undefined);
          return safeTarget;
        },
        args: [startSeconds],
      });

      const currentTime = results[0]?.result as number | null | undefined;
      if (typeof currentTime === 'number') {
        return { ok: true, currentTime };
      }

      return {
        ok: false,
        error: 'YouTube video player is not ready yet on this tab.',
      };
    } catch {
      return {
        ok: false,
        error: 'Open the matching YouTube tab to seek video playback directly.',
      };
    }
  }
}

/**
 * Seeks the YouTube HTML5 video player in the active tab to `startSeconds`.
 */
export async function seekActiveYouTubeVideo(
  startSeconds: number,
  deps?: YouTubeBridgeDeps,
): Promise<SeekVideoResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return {
      ok: false,
      error: 'Open the matching YouTube tab to seek video playback directly.',
    };
  }

  return seekTabVideo(tab.id, tab.url, startSeconds, deps);
}

/**
 * Smart cross-tab timestamp navigation:
 * 1. Seeks the active tab directly if it matches the lecture video.
 * 2. Focuses and seeks another open tab in the window with the same video ID.
 * 3. Opens a new YouTube tab at `&t=Xs` when invoked from any other page.
 */
export async function seekOrOpenVideo(
  sourceUrl: string | undefined,
  startSeconds: number,
  deps?: YouTubeBridgeDeps,
): Promise<SeekOrOpenResult> {
  const targetVideoId = sourceUrl ? extractVideoId(sourceUrl) : null;
  const deepLinkUrl = sourceUrl
    ? buildYouTubeTimestampUrl(sourceUrl, startSeconds)
    : null;

  const activeTab = await getActiveTab();
  const activeVideoId = activeTab?.url ? extractVideoId(activeTab.url) : null;

  if (
    activeTab?.id !== undefined &&
    ((targetVideoId && activeVideoId === targetVideoId) ||
      (!targetVideoId && isYouTubeUrl(activeTab.url)))
  ) {
    const res = await seekTabVideo(
      activeTab.id,
      activeTab.url,
      startSeconds,
      deps,
    );
    if (res.ok) {
      return {
        ok: true,
        action: 'seeked-active',
        currentTime: res.currentTime,
      };
    }
  }

  if (targetVideoId && typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const windowTabs = await chrome.tabs.query({ currentWindow: true });
    const match = windowTabs.find(
      (t) =>
        t.id !== undefined &&
        t.id !== activeTab?.id &&
        t.url &&
        extractVideoId(t.url) === targetVideoId,
    );

    if (match?.id !== undefined) {
      if (activeTab?.id !== undefined) {
        await pauseTabYouTubeVideo(activeTab.id, activeTab.url, deps);
      }
      await chrome.tabs.update?.(match.id, { active: true });
      const res = await seekTabVideo(match.id, match.url, startSeconds, deps);
      if (res.ok) {
        return {
          ok: true,
          action: 'seeked-existing-tab',
          currentTime: res.currentTime,
        };
      }
    }
  }

  if (deepLinkUrl && typeof chrome !== 'undefined' && chrome.tabs?.create) {
    if (activeTab?.id !== undefined) {
      await pauseTabYouTubeVideo(activeTab.id, activeTab.url, deps);
    }
    await chrome.tabs.create({ url: deepLinkUrl, active: true });
    return {
      ok: true,
      action: 'opened-new-tab',
      url: deepLinkUrl,
    };
  }

  return {
    ok: false,
    error: 'Timestamps can only seek or open YouTube lecture videos.',
  };
}

/**
 * Opens a lecture or article URL cleanly without triggering browser Auto-PiP
 * previews or duplicating an already-open tab for the same YouTube video.
 */
export async function openSourceUrl(
  rawUrl: string,
  deps?: YouTubeBridgeDeps,
): Promise<OpenSourceUrlResult> {
  const canonicalUrl = normalizeLectureUrl(rawUrl);
  const targetVideoId = extractVideoId(canonicalUrl);
  const activeTab = await getActiveTab();
  const activeVideoId = activeTab?.url ? extractVideoId(activeTab.url) : null;

  if (
    activeTab?.url &&
    ((targetVideoId && activeVideoId === targetVideoId) ||
      activeTab.url === canonicalUrl)
  ) {
    return {
      ok: true,
      action: 'already-active',
      url: canonicalUrl,
    };
  }

  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const windowTabs = await chrome.tabs.query({ currentWindow: true });
    const match = windowTabs.find(
      (t) =>
        t.id !== undefined &&
        t.id !== activeTab?.id &&
        t.url &&
        ((targetVideoId && extractVideoId(t.url) === targetVideoId) ||
          t.url === canonicalUrl),
    );

    if (match?.id !== undefined) {
      if (activeTab?.id !== undefined) {
        await pauseTabYouTubeVideo(activeTab.id, activeTab.url, deps);
      }
      await chrome.tabs.update?.(match.id, { active: true });
      return {
        ok: true,
        action: 'focused-existing-tab',
        url: canonicalUrl,
      };
    }
  }

  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    if (activeTab?.id !== undefined) {
      await pauseTabYouTubeVideo(activeTab.id, activeTab.url, deps);
    }
    await chrome.tabs.create({ url: canonicalUrl, active: true });
    return {
      ok: true,
      action: 'opened-new-tab',
      url: canonicalUrl,
    };
  }

  return {
    ok: false,
    error: 'Unable to open lecture URL outside Chrome extension context.',
  };
}

/**
 * Reads the current HTML5 playback time from a matching YouTube video tab so
 * users can stamp personal notes with one click.
 */
export async function getCurrentYouTubeVideoTime(
  sourceUrl?: string,
  deps?: YouTubeBridgeDeps,
): Promise<GetVideoTimeResponse> {
  const targetVideoId = sourceUrl ? extractVideoId(sourceUrl) : null;
  const activeTab = await getActiveTab();
  const activeVideoId = activeTab?.url ? extractVideoId(activeTab.url) : null;

  let targetTab: chrome.tabs.Tab | undefined;
  if (
    activeTab?.id !== undefined &&
    ((targetVideoId && activeVideoId === targetVideoId) ||
      (!targetVideoId && isYouTubeUrl(activeTab.url)))
  ) {
    targetTab = activeTab;
  } else if (
    targetVideoId &&
    typeof chrome !== 'undefined' &&
    chrome.tabs?.query
  ) {
    const windowTabs = await chrome.tabs.query({ currentWindow: true });
    targetTab = windowTabs.find(
      (t) => t.id !== undefined && t.url && extractVideoId(t.url) === targetVideoId,
    );
  }

  if (!targetTab?.id) {
    return {
      ok: false,
      error: 'Open the YouTube video tab to stamp its current playback time.',
    };
  }

  try {
    return await sendYouTubeMessage<GetVideoTimeResponse>(
      targetTab.id,
      targetTab.url,
      { type: 'GET_VIDEO_TIME' },
      deps,
    );
  } catch {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        func: () => {
          const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
          if (videos.length === 0) return null;

          let best: HTMLVideoElement | null = null;
          let bestScore = Number.NEGATIVE_INFINITY;
          for (const v of videos) {
            const rect = v.getBoundingClientRect();
            const isPreview = Boolean(
              v.closest('#inline-preview-player, ytd-video-preview'),
            );
            const isMain = Boolean(
              !isPreview &&
                (v.closest('#movie_player, ytd-player#ytd-player') ||
                  v.classList.contains('html5-main-video')),
            );
            let score = 0;
            if (isPreview) score -= 1000;
            if (rect.width < 20 || rect.height < 20) score -= 500;
            if (isMain) score += 400;
            if (Number.isFinite(v.duration) && v.duration > 0) score += 300;
            if (v.readyState >= 1) score += 150;
            if (!v.paused) score += 120;
            if (v.currentTime > 0) score += 80;
            if (score > bestScore) {
              bestScore = score;
              best = v;
            }
          }

          if (!best) return null;
          return Number.isFinite(best.currentTime)
            ? Math.max(0, Math.floor(best.currentTime))
            : 0;
        },
      });
      const currentSeconds = results[0]?.result as number | null | undefined;
      if (typeof currentSeconds === 'number') {
        return {
          ok: true,
          currentSeconds,
          timestamp: formatTimestamp(currentSeconds),
        };
      }
      return {
        ok: false,
        error: 'No active YouTube video player found on that tab.',
      };
    } catch {
      return {
        ok: false,
        error: 'Could not read current playback time from the YouTube tab.',
      };
    }
  }
}

/**
 * Opens a Chrome internal/flag URL in a new tab, falling back to copying the
 * URL to the clipboard when `chrome.tabs.create` is unavailable.
 */
export async function openChromePage(url: string): Promise<boolean> {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
    return true;
  }
  await navigator.clipboard?.writeText(url);
  return false;
}

import type {
  CaptureTranscriptResponse,
  ExtensionMessage,
  SeekVideoResponse,
  TranscriptSegment,
} from '../types/lecture';
import {
  extractCaptionTrackUrlFromHtml,
  extractVideoId,
  mergeCaptionSegments,
  parseJson3Captions,
  parseTranscriptDomRow,
  parseXmlCaptions,
} from './youtubeTranscriptParser';

const LISTENER_FLAG = '__lectureLensYoutubeListenerAttached';

function extractVideoTitle(): string {
  const heading = document.querySelector<HTMLElement>(
    'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string',
  );
  const rawHeading = heading?.textContent?.trim();
  if (rawHeading) return rawHeading;

  return (
    document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() ||
    'YouTube Lecture'
  );
}

function captureFromTranscriptDom(): TranscriptSegment[] {
  const raw: TranscriptSegment[] = [];

  // 1. Modern YouTube Web Component transcript layout (2025/2026)
  const modernNodes = document.querySelectorAll('transcript-segment-view-model');
  modernNodes.forEach((node) => {
    const timeEl = node.querySelector(
      '.ytwTranscriptSegmentViewModelTimestamp, [class*="timestamp" i], [class*="Timestamp"]',
    );
    const textEl = node.querySelector(
      '.ytwTranscriptSegmentViewModelText, yt-formatted-string, [class*="text" i], [class*="Text"]',
    );
    const timestampText = timeEl?.textContent?.trim() ?? '';
    const bodyText =
      textEl && textEl !== timeEl
        ? textEl.textContent ?? ''
        : node.textContent ?? '';

    const parsed = parseTranscriptDomRow(timestampText, bodyText);
    if (parsed) raw.push(parsed);
  });

  if (raw.length > 0) {
    return mergeCaptionSegments(raw);
  }

  // 2. Legacy YouTube transcript panel layout
  const legacyNodes = document.querySelectorAll('ytd-transcript-segment-renderer');
  legacyNodes.forEach((node) => {
    const timeEl = node.querySelector('.segment-timestamp');
    const textEl = node.querySelector('.segment-text');
    const parsed = parseTranscriptDomRow(
      timeEl?.textContent ?? '',
      textEl?.textContent ?? '',
    );
    if (parsed) raw.push(parsed);
  });

  return mergeCaptionSegments(raw);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findShowTranscriptButton(): HTMLElement | null {
  const direct = document.querySelector<HTMLElement>(
    'ytd-video-description-transcript-section-renderer button, button[aria-label*="transcript" i]',
  );
  if (direct) return direct;

  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button'));
  return (
    buttons.find((btn) =>
      /show\s+transcript/i.test(btn.textContent ?? '') ||
      /transcript/i.test(btn.getAttribute('aria-label') ?? ''),
    ) ?? null
  );
}

async function openTranscriptPanelAndCapture(): Promise<TranscriptSegment[]> {
  let button = findShowTranscriptButton();

  if (!button) {
    const expandBtn = document.querySelector<HTMLElement>(
      'tp-yt-paper-button#expand, #description-inline-expander #expand, #expand',
    );
    if (expandBtn) {
      expandBtn.click();
      await delay(300);
      button = findShowTranscriptButton();
    }
  }

  if (!button) {
    return [];
  }

  button.click();

  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    await delay(150);
    const segments = captureFromTranscriptDom();
    if (segments.length > 0) {
      return segments;
    }
  }

  return [];
}

async function captureFromCaptionTracks(
  pageUrl: string,
): Promise<TranscriptSegment[]> {
  const pageRes = await fetch(pageUrl, { credentials: 'include' });
  if (!pageRes.ok) {
    throw new Error(`Failed to fetch YouTube watch page (${pageRes.status}).`);
  }

  const html = await pageRes.text();
  const trackUrl = extractCaptionTrackUrlFromHtml(html);
  if (!trackUrl) {
    return [];
  }

  const jsonUrl = trackUrl.includes('fmt=')
    ? trackUrl
    : `${trackUrl}&fmt=json3`;

  try {
    const jsonRes = await fetch(jsonUrl);
    if (jsonRes.ok) {
      const textBody = await jsonRes.text();
      if (textBody.trim()) {
        const parsed = parseJson3Captions(JSON.parse(textBody) as unknown);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch {
    // Fall through to XML caption track
  }

  const xmlRes = await fetch(trackUrl);
  if (!xmlRes.ok) return [];
  const xmlText = await xmlRes.text();
  return parseXmlCaptions(xmlText);
}

async function handleCaptureTranscript(): Promise<CaptureTranscriptResponse> {
  const url = window.location.href;
  const videoId = extractVideoId(url);
  if (!videoId) {
    return {
      ok: false,
      error:
        'Open a YouTube video watch page (youtube.com/watch?v=...) to capture a transcript, or paste text manually.',
    };
  }

  const title = extractVideoTitle();

  // Strategy 1: Already-mounted transcript panel DOM
  const domSegments = captureFromTranscriptDom();
  if (domSegments.length > 0) {
    return { ok: true, videoId, title, url, segments: domSegments };
  }

  // Strategy 2: Auto-open YouTube's native "Show transcript" panel & extract DOM
  const panelSegments = await openTranscriptPanelAndCapture();
  if (panelSegments.length > 0) {
    return { ok: true, videoId, title, url, segments: panelSegments };
  }

  // Strategy 3: Player captionTracks fallback
  try {
    const trackSegments = await captureFromCaptionTracks(url);
    if (trackSegments.length > 0) {
      return { ok: true, videoId, title, url, segments: trackSegments };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown fetch error';
    return {
      ok: false,
      error: `Could not read YouTube captions (${detail}). Open "Show transcript" below the video or paste text below.`,
    };
  }

  return {
    ok: false,
    error:
      'No captions or transcript were found for this video. Scroll down to click "Show transcript" or paste text below.',
  };
}

function handleSeekVideo(startSeconds: number): SeekVideoResponse {
  const video = document.querySelector<HTMLVideoElement>('video');
  if (!video) {
    return {
      ok: false,
      error: 'No active YouTube video player was found on this tab.',
    };
  }

  const safeTarget = Number.isFinite(startSeconds)
    ? Math.max(0, startSeconds)
    : 0;
  video.currentTime = safeTarget;
  void video.play().catch(() => undefined);

  return { ok: true, currentTime: video.currentTime };
}

const globalState = globalThis as Record<string, unknown>;
if (!globalState[LISTENER_FLAG]) {
  globalState[LISTENER_FLAG] = true;
  chrome.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      _sender,
      sendResponse: (
        response: CaptureTranscriptResponse | SeekVideoResponse,
      ) => void,
    ) => {
      if (!message || typeof message !== 'object') return false;

      if (message.type === 'CAPTURE_TRANSCRIPT') {
        void handleCaptureTranscript().then(sendResponse);
        return true;
      }

      if (message.type === 'SEEK_VIDEO') {
        sendResponse(handleSeekVideo(message.startSeconds));
        return false;
      }

      return false;
    },
  );
}

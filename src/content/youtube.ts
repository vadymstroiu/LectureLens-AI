import type {
  CaptureTranscriptResponse,
  ExtensionMessage,
  SeekVideoResponse,
  TranscriptSegment,
} from '../types/lecture';
import {
  extractCaptionTrackUrlFromHtml,
  extractVideoId,
  formatTimestamp,
  mergeCaptionSegments,
  parseJson3Captions,
  parseTimestampToSeconds,
  parseXmlCaptions,
} from './youtubeTranscriptParser';

function extractVideoTitle(): string {
  const heading = document.querySelector<HTMLElement>(
    'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string',
  );
  const rawHeading = heading?.textContent?.trim();
  if (rawHeading) return rawHeading;

  return document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'YouTube Lecture';
}

function captureFromTranscriptDom(): TranscriptSegment[] {
  const nodes = document.querySelectorAll('ytd-transcript-segment-renderer');
  if (!nodes.length) return [];

  const raw: TranscriptSegment[] = [];
  nodes.forEach((node) => {
    const timeEl = node.querySelector('.segment-timestamp');
    const textEl = node.querySelector('.segment-text');
    const timestampText = timeEl?.textContent?.trim() ?? '';
    const text = textEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!text) return;

    const startSeconds = parseTimestampToSeconds(timestampText);
    raw.push({
      startSeconds,
      timestamp: formatTimestamp(startSeconds),
      text,
    });
  });

  return mergeCaptionSegments(raw);
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
      const jsonPayload: unknown = await jsonRes.json();
      const parsed = parseJson3Captions(jsonPayload);
      if (parsed.length > 0) return parsed;
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

  // Strategy 1: Mounted transcript panel DOM (exact user-visible timestamps)
  const domSegments = captureFromTranscriptDom();
  if (domSegments.length > 0) {
    return { ok: true, videoId, title, url, segments: domSegments };
  }

  // Strategy 2: Player captionTracks from fresh watch HTML
  try {
    const trackSegments = await captureFromCaptionTracks(url);
    if (trackSegments.length > 0) {
      return { ok: true, videoId, title, url, segments: trackSegments };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown fetch error';
    return {
      ok: false,
      error: `Could not read YouTube captions (${detail}). You can open YouTube's "Show transcript" panel or paste text below.`,
    };
  }

  return {
    ok: false,
    error:
      'No captions or transcript segments were found for this video. Try opening "Show transcript" below the video or paste text manually.',
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

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender,
    sendResponse: (response: CaptureTranscriptResponse | SeekVideoResponse) => void,
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

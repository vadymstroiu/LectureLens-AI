import type { TranscriptSegment } from '../types/lecture';

interface Json3Seg {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
}

interface Json3Payload {
  events?: Json3Event[];
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

/**
 * Formats seconds into mm:ss or h:mm:ss.
 */
export function formatTimestamp(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Parses mm:ss or h:mm:ss strings into total seconds.
 */
export function parseTimestampToSeconds(timestamp: string): number {
  const cleaned = timestamp.replace(/[[\]\s]/g, '');
  if (!cleaned) return 0;

  const parts = cleaned.split(':').map((part) => Number(part));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return 0;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Extracts a YouTube video ID from watch, shorts, live, or youtu.be URLs.
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }

    if (host.endsWith('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;

      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (
        pathParts.length >= 2 &&
        (pathParts[0] === 'shorts' ||
          pathParts[0] === 'live' ||
          pathParts[0] === 'embed')
      ) {
        return pathParts[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeCaptionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  return input
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (match) => named[match] ?? match)
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
}

/**
 * Merges tiny caption fragments into coherent ~10-second study segments
 * so timestamps stay clickable without fragmenting sentences.
 */
export function mergeCaptionSegments(
  rawSegments: TranscriptSegment[],
  maxWindowSeconds = 12,
  maxSegmentChars = 220,
): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];

  for (const item of rawSegments) {
    const cleanedText = normalizeCaptionText(item.text);
    if (!cleanedText) continue;

    const last = merged[merged.length - 1];
    if (
      last &&
      item.startSeconds - last.startSeconds <= maxWindowSeconds &&
      last.text.length + cleanedText.length + 1 <= maxSegmentChars
    ) {
      last.text = `${last.text} ${cleanedText}`;
    } else {
      const startSeconds = Math.max(0, Math.floor(item.startSeconds));
      merged.push({
        startSeconds,
        timestamp: formatTimestamp(startSeconds),
        text: cleanedText,
      });
    }
  }

  return merged;
}

/**
 * Parses YouTube timedtext JSON3 payload into timestamped segments.
 */
export function parseJson3Captions(payload: unknown): TranscriptSegment[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const events = (payload as Json3Payload).events;
  if (!Array.isArray(events)) {
    return [];
  }

  const raw: TranscriptSegment[] = [];
  for (const event of events) {
    if (!event || !Array.isArray(event.segs)) continue;
    const text = normalizeCaptionText(
      event.segs.map((seg) => seg.utf8 ?? '').join(''),
    );
    if (!text) continue;

    const startSeconds = Math.max(0, Math.floor((event.tStartMs ?? 0) / 1000));
    raw.push({
      startSeconds,
      timestamp: formatTimestamp(startSeconds),
      text,
    });
  }

  return mergeCaptionSegments(raw);
}

/**
 * Parses YouTube XML timedtext captions into timestamped segments.
 */
export function parseXmlCaptions(xml: string): TranscriptSegment[] {
  if (!xml) return [];

  const raw: TranscriptSegment[] = [];
  const pattern = /<text\b[^>]*start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml)) !== null) {
    const startNumeric = Number.parseFloat(match[1]);
    const startSeconds = Number.isFinite(startNumeric)
      ? Math.max(0, Math.floor(startNumeric))
      : 0;
    const stripped = match[2].replace(/<[^>]+>/g, ' ');
    const decoded = normalizeCaptionText(decodeHtmlEntities(stripped));
    if (!decoded) continue;

    raw.push({
      startSeconds,
      timestamp: formatTimestamp(startSeconds),
      text: decoded,
    });
  }

  return mergeCaptionSegments(raw);
}

/**
 * Extracts the best caption track URL from YouTube watch HTML (ytInitialPlayerResponse).
 */
export function extractCaptionTrackUrlFromHtml(html: string): string | null {
  const marker = '"captionTracks":';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const arrayStart = html.indexOf('[', markerIdx);
  if (arrayStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let arrayEnd = -1;

  for (let i = arrayStart; i < html.length; i++) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          arrayEnd = i;
          break;
        }
      }
    }
  }

  if (arrayEnd === -1) return null;

  try {
    const tracks = JSON.parse(html.slice(arrayStart, arrayEnd + 1)) as CaptionTrack[];
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    const preferred =
      tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ??
      tracks.find((t) => t.languageCode?.startsWith('en')) ??
      tracks.find((t) => t.kind !== 'asr') ??
      tracks[0];

    const rawUrl = preferred?.baseUrl ?? null;
    return rawUrl ? rawUrl.replace(/\\u0026/g, '&') : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes a DOM transcript row (timestamp + body text) into a TranscriptSegment.
 */
export function parseTranscriptDomRow(
  timestampText: string,
  bodyText: string,
): TranscriptSegment | null {
  const cleanedTimestamp = timestampText.trim();
  let cleanedBody = normalizeCaptionText(bodyText);

  if (cleanedTimestamp && cleanedBody.startsWith(cleanedTimestamp)) {
    cleanedBody = normalizeCaptionText(
      cleanedBody.slice(cleanedTimestamp.length),
    );
  }

  if (!cleanedBody) return null;

  const startSeconds = parseTimestampToSeconds(cleanedTimestamp);
  return {
    startSeconds,
    timestamp: formatTimestamp(startSeconds),
    text: cleanedBody,
  };
}

/**
 * Formats segments into `[mm:ss] text` lines for LLM ingestion & character counting.
 */
export function formatSegmentsAsTranscript(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${s.timestamp}] ${s.text}`).join('\n');
}

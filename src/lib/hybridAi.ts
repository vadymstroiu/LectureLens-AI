import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type AI,
  type GenerateContentResult,
  type GenerativeModel,
  type HybridParams,
} from 'firebase/ai';
import { normalizeTimestampFields } from '../content/youtubeTranscriptParser';
import type {
  Flashcard,
  FlashcardsData,
  HybridRoutingPolicy,
  InferenceSourceValue,
  InferenceTelemetry,
  OnDeviceAvailability,
  QuizData,
  QuizQuestion,
  SimpleExplanation,
  StudyNotesData,
  StudyTaskKind,
  TranscriptChunk,
  TranscriptSegment,
} from '../types/lecture';
import { getFirebaseAI, isFirebaseConfigured } from './firebase';

export const ON_DEVICE_CHAR_LIMIT = 6000;
export const FULL_LECTURE_CHAR_LIMIT = 60000;
export const ALL_CHAPTERS_ID = 'all';
export const MAX_ON_DEVICE_CHAPTERS = 12;
export const HYBRID_ON_DEVICE_MAX_CHAPTERS = 3;
export const ON_DEVICE_CALL_TIMEOUT_MS = 45_000;
export const CLOUD_MODEL_NAME =
  (import.meta.env.VITE_FIREBASE_CLOUD_MODEL ?? '').trim() ||
  'gemini-3.8-flash';

export type HybridAiErrorCode =
  | 'ON_DEVICE_UNAVAILABLE'
  | 'FIREBASE_NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'EMPTY_CONTENT'
  | 'INVALID_RESPONSE'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'INFERENCE_FAILED';

export class HybridAiError extends Error {
  readonly code: HybridAiErrorCode;
  readonly recoveryHint?: string;

  constructor(
    code: HybridAiErrorCode,
    message: string,
    recoveryHint?: string,
  ) {
    super(message);
    this.name = 'HybridAiError';
    this.code = code;
    this.recoveryHint = recoveryHint;
  }
}

export interface ContentWindowAnalysis {
  charCount: number;
  fitsOnDevice: boolean;
  recommendedEngine: 'ON_DEVICE' | 'IN_CLOUD';
  hint: string;
}

export interface HybridCallResult<T> {
  data: T;
  telemetry: InferenceTelemetry;
}

export interface StudyTargetCounts {
  takeawaysMin: number;
  takeawaysMax: number;
  definitionsMin: number;
  definitionsMax: number;
  flashcardsMin: number;
  flashcardsMax: number;
  quizCount: number;
}

export interface HybridInferenceDeps {
  ai?: AI;
  modelFactory?: (ai: AI, params: HybridParams) => Pick<GenerativeModel, 'generateContent'>;
  now?: () => number;
  onDownloadProgress?: (percent: number) => void;
  onChapterProgress?: (current: number, total: number, label: string) => void;
  checkAvailability?: () => Promise<OnDeviceAvailability>;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  onDeviceTimeoutMs?: number;
  onPartialNotes?: (
    data: StudyNotesData,
    completedChapters: number,
    totalChapters: number,
  ) => void;
  onPartialFlashcards?: (
    data: FlashcardsData,
    completedChapters: number,
    totalChapters: number,
  ) => void;
  distilledNotes?: StudyNotesData;
  targetTakeaways?: [number, number];
  targetDefinitions?: [number, number];
  targetFlashcards?: [number, number];
  questionCount?: number;
  idPrefix?: string;
}

interface OnDeviceLanguageSpec {
  type: 'text';
  languages: string[];
}

interface OnDeviceLanguageOptions {
  expectedInputs?: OnDeviceLanguageSpec[];
  expectedOutputs?: OnDeviceLanguageSpec[];
}

const DEFAULT_ON_DEVICE_LANGUAGE_OPTIONS: OnDeviceLanguageOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

interface ChromeLanguageModelGlobal {
  LanguageModel?: {
    availability?: (options?: OnDeviceLanguageOptions) => Promise<string>;
    create?: (
      options?: OnDeviceLanguageOptions & {
        signal?: AbortSignal;
        monitor?: (m: {
          addEventListener: (
            eventType: 'downloadprogress',
            listener: (e: { loaded: number }) => void,
          ) => void;
        }) => void;
      },
    ) => Promise<{ destroy?: () => void }>;
  };
}

// --- Structured Output Schemas (firebase/ai Schema) ---

function clampMinForLength(requestedMin: number, charLength: number): number {
  if (charLength >= 1800) return requestedMin;
  if (charLength >= 600) return Math.min(requestedMin, 2);
  return 1;
}

export function buildStudyNotesSchema(
  takeawaysBounds?: [number, number],
  definitionsBounds?: [number, number],
) {
  return Schema.object({
    properties: {
      overview: Schema.string({
        description: 'Concise synthesis of the lecture or section.',
      }),
      takeaways: Schema.array({
        description: 'Key takeaways anchored to transcript timestamps.',
        ...(takeawaysBounds
          ? {
              minItems: takeawaysBounds[0],
              maxItems: takeawaysBounds[1],
            }
          : {}),
        items: Schema.object({
          properties: {
            point: Schema.string(),
            timestamp: Schema.string({
              description: 'mm:ss timestamp from the transcript, e.g. 01:35',
            }),
            startSeconds: Schema.integer(),
          },
        }),
      }),
      definitions: Schema.array({
        description: 'Core technical terms and concise definitions.',
        ...(definitionsBounds
          ? {
              minItems: definitionsBounds[0],
              maxItems: definitionsBounds[1],
            }
          : {}),
        items: Schema.object({
          properties: {
            term: Schema.string(),
            definition: Schema.string(),
            timestamp: Schema.string({
              description: 'mm:ss timestamp where the term is introduced',
            }),
            startSeconds: Schema.integer(),
          },
        }),
      }),
    },
  });
}

export const studyNotesSchema = buildStudyNotesSchema();

export function buildFlashcardsSchema(cardBounds?: [number, number]) {
  return Schema.object({
    properties: {
      cards: Schema.array({
        description: 'Active-recall study flashcards.',
        ...(cardBounds
          ? {
              minItems: cardBounds[0],
              maxItems: cardBounds[1],
            }
          : {}),
        items: Schema.object({
          properties: {
            id: Schema.string(),
            front: Schema.string({
              description: 'Concise active-recall question or concept prompt.',
            }),
            back: Schema.string({
              description: 'Clear, accurate answer in 1-3 sentences.',
            }),
            timestamp: Schema.string({
              description: 'mm:ss source timestamp in the lecture',
            }),
            startSeconds: Schema.integer(),
          },
        }),
      }),
    },
  });
}

export const flashcardsSchema = buildFlashcardsSchema();

export function buildQuizSchema(questionCount?: number) {
  return Schema.object({
    properties: {
      questions: Schema.array({
        description:
          'Multiple-choice practice questions spanning the full lecture.',
        ...(questionCount !== undefined
          ? {
              minItems: questionCount,
              maxItems: questionCount,
            }
          : {}),
        items: Schema.object({
          properties: {
            id: Schema.string(),
            question: Schema.string(),
            options: Schema.array({
              minItems: 4,
              maxItems: 4,
              items: Schema.string(),
            }),
            correctIndex: Schema.integer({
              description: '0-based index (0..3) of the correct option.',
            }),
            explanation: Schema.string(),
            timestamp: Schema.string({
              description: 'mm:ss timestamp where this concept is explained',
            }),
            startSeconds: Schema.integer(),
          },
        }),
      }),
    },
  });
}

export const quizSchema = buildQuizSchema();

export const simpleExplanationSchema = Schema.object({
  properties: {
    analogy: Schema.string({
      description: 'A 1-2 sentence intuitive everyday analogy.',
    }),
    keyIdea: Schema.string({
      description: 'One crisp takeaway sentence.',
    }),
  },
});

// Plain JSON Schema constraints for Chrome's on-device Prompt API
function buildStudyNotesJsonConstraint(
  takeawaysBounds?: [number, number],
  definitionsBounds?: [number, number],
) {
  return {
    type: 'object',
    properties: {
      overview: { type: 'string' },
      takeaways: {
        type: 'array',
        ...(takeawaysBounds
          ? {
              minItems: takeawaysBounds[0],
              maxItems: takeawaysBounds[1],
            }
          : {}),
        items: {
          type: 'object',
          properties: {
            point: { type: 'string' },
            timestamp: { type: 'string' },
            startSeconds: { type: 'integer' },
          },
          required: ['point', 'timestamp', 'startSeconds'],
        },
      },
      definitions: {
        type: 'array',
        ...(definitionsBounds
          ? {
              minItems: definitionsBounds[0],
              maxItems: definitionsBounds[1],
            }
          : {}),
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            definition: { type: 'string' },
            timestamp: { type: 'string' },
            startSeconds: { type: 'integer' },
          },
          required: ['term', 'definition', 'timestamp', 'startSeconds'],
        },
      },
    },
    required: ['overview', 'takeaways', 'definitions'],
  };
}

function buildFlashcardsJsonConstraint(cardBounds?: [number, number]) {
  return {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        ...(cardBounds
          ? {
              minItems: cardBounds[0],
              maxItems: cardBounds[1],
            }
          : {}),
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            front: { type: 'string' },
            back: { type: 'string' },
            timestamp: { type: 'string' },
            startSeconds: { type: 'integer' },
          },
          required: ['id', 'front', 'back', 'timestamp', 'startSeconds'],
        },
      },
    },
    required: ['cards'],
  };
}

const SIMPLE_EXPLANATION_JSON_CONSTRAINT = {
  type: 'object',
  properties: {
    analogy: { type: 'string' },
    keyIdea: { type: 'string' },
  },
  required: ['analogy', 'keyIdea'],
};

// --- Helper Utilities ---

export function analyzeContentWindow(text: string): ContentWindowAnalysis {
  const charCount = text.trim().length;
  const fitsOnDevice = charCount <= ON_DEVICE_CHAR_LIMIT;
  return {
    charCount,
    fitsOnDevice,
    recommendedEngine: fitsOnDevice ? 'ON_DEVICE' : 'IN_CLOUD',
    hint:
      charCount === 0
        ? 'Capture a YouTube transcript or paste text to begin.'
        : fitsOnDevice
          ? 'Fits on-device window • Ready for Gemini Nano'
          : charCount > ON_DEVICE_CHAR_LIMIT * HYBRID_ON_DEVICE_MAX_CHAPTERS
            ? 'Long lecture • Hybrid uses Cloud Notes & Cloud Quiz + On-Device Nano Flashcards'
            : 'Long lecture • Cloud Quiz recommended (select a chapter for Nano)',
  };
}

export function chunkTranscriptSegments(
  segments: TranscriptSegment[],
  maxChars = ON_DEVICE_CHAR_LIMIT,
): TranscriptChunk[] {
  if (!segments.length) return [];

  const chunks: TranscriptChunk[] = [];
  let currentSegments: TranscriptSegment[] = [];
  let currentChars = 0;

  const flush = () => {
    if (!currentSegments.length) return;
    const first = currentSegments[0];
    const last = currentSegments[currentSegments.length - 1];
    const text = currentSegments
      .map((s) => `[${s.timestamp}] ${s.text}`)
      .join('\n');
    const idx = chunks.length + 1;
    chunks.push({
      id: `chunk-${idx}`,
      label: `Part ${idx} (${first.timestamp}–${last.timestamp})`,
      startTimestamp: first.timestamp,
      endTimestamp: last.timestamp,
      startSeconds: first.startSeconds,
      endSeconds: last.startSeconds,
      charCount: text.length,
      text,
      segments: currentSegments,
    });
    currentSegments = [];
    currentChars = 0;
  };

  for (const segment of segments) {
    const line = `[${segment.timestamp}] ${segment.text}`;
    const lineLength = line.length + 1;

    if (currentSegments.length > 0 && currentChars + lineLength > maxChars) {
      flush();
    }

    currentSegments.push(segment);
    currentChars += lineLength;
  }

  flush();
  return chunks;
}

/**
 * Computes scaled study item target counts proportional to content length.
 */
export function computeTargetCounts(charCount: number): StudyTargetCounts {
  if (charCount <= ON_DEVICE_CHAR_LIMIT) {
    return {
      takeawaysMin: 5,
      takeawaysMax: 7,
      definitionsMin: 4,
      definitionsMax: 6,
      flashcardsMin: 6,
      flashcardsMax: 8,
      quizCount: 5,
    };
  }
  if (charCount <= 18000) {
    return {
      takeawaysMin: 8,
      takeawaysMax: 12,
      definitionsMin: 6,
      definitionsMax: 9,
      flashcardsMin: 10,
      flashcardsMax: 14,
      quizCount: 8,
    };
  }
  if (charCount <= 36000) {
    return {
      takeawaysMin: 12,
      takeawaysMax: 16,
      definitionsMin: 8,
      definitionsMax: 12,
      flashcardsMin: 15,
      flashcardsMax: 20,
      quizCount: 10,
    };
  }
  return {
    takeawaysMin: 16,
    takeawaysMax: 22,
    definitionsMin: 10,
    definitionsMax: 15,
    flashcardsMin: 18,
    flashcardsMax: 24,
    quizCount: 12,
  };
}

/**
 * Selects up to `maxCount` evenly distributed chunks spanning start to end.
 */
export function selectRepresentativeChunks(
  chunks: TranscriptChunk[],
  maxCount = MAX_ON_DEVICE_CHAPTERS,
): TranscriptChunk[] {
  if (chunks.length <= maxCount || maxCount <= 0) return chunks;
  if (maxCount === 1) return [chunks[0]];

  const pickedIndices = new Set<number>();
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.round((i * (chunks.length - 1)) / (maxCount - 1));
    pickedIndices.add(idx);
  }
  return Array.from(pickedIndices)
    .sort((a, b) => a - b)
    .map((idx) => chunks[idx]);
}

/**
 * Filters timestamped study items to the selected chapter without dropping or
 * duplicating items that land in gaps between adjacent chapter boundaries.
 */
export function filterItemsByChunk<T extends { startSeconds: number }>(
  items: T[],
  chunks: TranscriptChunk[],
  selectedChunkId: string,
): T[] {
  if (selectedChunkId === ALL_CHAPTERS_ID || chunks.length <= 1) {
    return items;
  }
  const idx = chunks.findIndex((c) => c.id === selectedChunkId);
  if (idx === -1) return items;

  const lowerBound = idx === 0 ? Number.NEGATIVE_INFINITY : chunks[idx].startSeconds;
  const upperBound =
    idx === chunks.length - 1
      ? Number.POSITIVE_INFINITY
      : chunks[idx + 1].startSeconds;

  return items.filter(
    (item) => item.startSeconds >= lowerBound && item.startSeconds < upperBound,
  );
}

/**
 * Merges incoming study notes with existing notes, deduplicating takeaways and
 * definitions and preserving chronological timestamp order.
 */
export function mergeStudyNotes(
  existing: StudyNotesData | undefined,
  incoming: StudyNotesData,
): StudyNotesData {
  const overview = existing?.overview?.trim() || incoming.overview.trim();

  const takeawayMap = new Map<string, StudyNotesData['takeaways'][number]>();
  for (const item of [...(existing?.takeaways ?? []), ...incoming.takeaways]) {
    const key = item.point.trim().toLowerCase();
    if (key && !takeawayMap.has(key)) {
      takeawayMap.set(key, item);
    }
  }

  const defMap = new Map<string, StudyNotesData['definitions'][number]>();
  for (const def of [...(existing?.definitions ?? []), ...incoming.definitions]) {
    const key = def.term.trim().toLowerCase();
    if (key && !defMap.has(key)) {
      defMap.set(key, def);
    }
  }

  return {
    overview,
    takeaways: Array.from(takeawayMap.values()).sort(
      (a, b) => a.startSeconds - b.startSeconds,
    ),
    definitions: Array.from(defMap.values()).sort(
      (a, b) => a.startSeconds - b.startSeconds,
    ),
  };
}

/**
 * Formats extracted Cloud Study Notes into a compact timestamped summary
 * (<6,000 chars) so Gemini Nano can synthesize flashcards locally in 1 pass.
 */
export function formatNotesForOnDeviceDistillation(
  notes: StudyNotesData,
): string {
  const lines: string[] = [];
  if (notes.overview.trim()) {
    lines.push(`Overview: ${notes.overview.trim()}`);
  }
  for (const item of notes.takeaways) {
    const point = item.point.trim();
    if (!point) continue;
    const ts = item.timestamp.trim() || '00:00';
    lines.push(`[${ts}] Key takeaway: ${point}`);
  }
  for (const def of notes.definitions) {
    const term = def.term.trim();
    const definition = def.definition.trim();
    if (!term || !definition) continue;
    const ts = def.timestamp.trim() || '00:00';
    lines.push(`[${ts}] ${term}: ${definition}`);
  }
  return lines.join('\n').trim();
}

/**
 * Merges incoming flashcards with an existing deck, deduplicating by front
 * prompt, guaranteeing unique card IDs, and sorting chronologically.
 */
export function mergeFlashcards(
  existing: FlashcardsData | undefined,
  incoming: FlashcardsData,
): FlashcardsData {
  const seenFronts = new Set<string>();
  const usedIds = new Set<string>();
  const merged: Flashcard[] = [];

  for (const card of [...(existing?.cards ?? []), ...incoming.cards]) {
    const frontKey = card.front.trim().toLowerCase();
    if (!frontKey || seenFronts.has(frontKey)) continue;
    seenFronts.add(frontKey);

    let cardId = card.id.trim() || `card-${merged.length + 1}`;
    if (usedIds.has(cardId)) {
      cardId = `${cardId}-${merged.length + 1}`;
    }
    usedIds.add(cardId);
    merged.push({ ...card, id: cardId });
  }

  merged.sort((a, b) => a.startSeconds - b.startSeconds);
  return { cards: merged };
}

export function resolveLocalFirstMode(
  policy: HybridRoutingPolicy,
): InferenceMode {
  return policy === 'local-only'
    ? InferenceMode.ONLY_ON_DEVICE
    : InferenceMode.PREFER_ON_DEVICE;
}

export async function checkOnDeviceAvailability(): Promise<OnDeviceAvailability> {
  const api = (globalThis as unknown as ChromeLanguageModelGlobal).LanguageModel;
  if (!api?.availability) return 'unavailable';

  try {
    const status = await api.availability(DEFAULT_ON_DEVICE_LANGUAGE_OPTIONS);
    if (status === 'available' || status === 'readily') return 'available';
    if (status === 'downloadable' || status === 'after-download') {
      return 'downloadable';
    }
    if (status === 'downloading') return 'downloading';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function formatLatency(latencyMs: number): string {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return '0ms';
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`;
  if (latencyMs < 60_000) return `${(latencyMs / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(latencyMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Computes an asymptotic execution percentage (0..95) + remaining percentage
 * from elapsed milliseconds while an AI request is running.
 */
export function computeExecutionProgress(
  elapsedMs: number,
  expectedMs = 4500,
): { percent: number; remainingPercent: number } {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { percent: 0, remainingPercent: 100 };
  }
  const safeExpected = expectedMs > 0 ? expectedMs : 4500;
  const percent = Math.min(
    95,
    Math.max(1, Math.round((1 - Math.exp(-elapsedMs / safeExpected)) * 95)),
  );
  return {
    percent,
    remainingPercent: 100 - percent,
  };
}

/**
 * Computes overall progress across multi-chapter AI execution so long
 * lectures advance smoothly through each chapter band instead of pinning at 95%.
 */
export function computePipelineExecutionProgress(params: {
  elapsedMs: number;
  chapterElapsedMs?: number;
  chapterIndex?: number;
  totalChapters?: number;
  expectedMs?: number;
}): { percent: number; remainingPercent: number } {
  const { elapsedMs, chapterElapsedMs, chapterIndex, totalChapters, expectedMs } =
    params;
  if (totalChapters && totalChapters > 1 && chapterIndex && chapterIndex >= 1) {
    const completed = Math.min(totalChapters - 1, Math.max(0, chapterIndex - 1));
    const withinChapter =
      computeExecutionProgress(
        chapterElapsedMs ?? elapsedMs,
        expectedMs ?? 15_000,
      ).percent / 100;
    const percent = Math.min(
      99,
      Math.max(1, Math.round(((completed + withinChapter) / totalChapters) * 100)),
    );
    return {
      percent,
      remainingPercent: 100 - percent,
    };
  }
  return computeExecutionProgress(elapsedMs, expectedMs);
}

/**
 * Explicitly initiates/monitors Chrome's Gemini Nano download from a user click.
 */
export async function triggerOnDeviceDownload(
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<OnDeviceAvailability> {
  if (signal?.aborted) {
    throw new HybridAiError('ABORTED', 'Download tracking was cancelled.');
  }

  const api = (globalThis as unknown as ChromeLanguageModelGlobal).LanguageModel;
  if (!api?.create) {
    return checkOnDeviceAvailability();
  }

  try {
    const session = await api.create({
      ...DEFAULT_ON_DEVICE_LANGUAGE_OPTIONS,
      ...(signal ? { signal } : {}),
      monitor: (m) => {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.min(
            100,
            Math.max(0, Math.round((e.loaded ?? 0) * 100)),
          );
          onProgress(pct);
        });
      },
    });
    session?.destroy?.();
    return checkOnDeviceAvailability();
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw new HybridAiError('ABORTED', 'Download tracking was cancelled.');
    }
    throw error;
  }
}

export function normalizeInferenceSource(
  rawSource: InferenceSource | string | undefined,
  fallbackMode: InferenceMode,
): InferenceSourceValue {
  const normalized = String(rawSource ?? '').toLowerCase();
  if (
    normalized === InferenceSource.ON_DEVICE ||
    normalized === 'on_device'
  ) {
    return 'ON_DEVICE';
  }
  if (
    normalized === InferenceSource.IN_CLOUD ||
    normalized === 'in_cloud'
  ) {
    return 'IN_CLOUD';
  }
  return fallbackMode === InferenceMode.ONLY_ON_DEVICE
    ? 'ON_DEVICE'
    : 'IN_CLOUD';
}

export function parseStructuredJson<T>(rawText: string): T {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new HybridAiError(
      'INVALID_RESPONSE',
      'The model returned an empty response.',
    );
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parseCandidate = (candidate: string): T => {
    const parsed: unknown = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed JSON is not an object.');
    }
    return parsed as T;
  };

  try {
    return parseCandidate(withoutFence);
  } catch {
    const firstBrace = withoutFence.indexOf('{');
    const lastBrace = withoutFence.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return parseCandidate(withoutFence.slice(firstBrace, lastBrace + 1));
      } catch {
        // Fall through to error
      }
    }
    throw new HybridAiError(
      'INVALID_RESPONSE',
      'Model output was not valid JSON matching the study schema.',
      'Try running the generation again, or switch to Hybrid (Auto) if a local model truncated output.',
    );
  }
}

// --- Model Parameter Builders (Exported for Testability) ---

function buildOnDeviceCreateOptions(
  onDownloadProgress?: (percent: number) => void,
  signal?: AbortSignal,
) {
  return {
    ...DEFAULT_ON_DEVICE_LANGUAGE_OPTIONS,
    ...(signal ? { signal } : {}),
    ...(onDownloadProgress
      ? {
          monitor: (m: {
            addEventListener: (
              eventType: 'downloadprogress',
              listener: (e: { loaded: number }) => void,
            ) => void;
          }) => {
            m.addEventListener('downloadprogress', (e) => {
              const pct = Math.min(
                100,
                Math.max(0, Math.round((e.loaded ?? 0) * 100)),
              );
              onDownloadProgress(pct);
            });
          },
        }
      : {}),
  };
}

export function buildNotesModelParams(
  policy: HybridRoutingPolicy,
  onDownloadProgress?: (percent: number) => void,
  takeawaysBounds?: [number, number],
  definitionsBounds?: [number, number],
  signal?: AbortSignal,
): HybridParams {
  return {
    mode: resolveLocalFirstMode(policy),
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: buildStudyNotesSchema(
          takeawaysBounds,
          definitionsBounds,
        ),
        temperature: 0.2,
      },
    },
    onDeviceParams: {
      createOptions: buildOnDeviceCreateOptions(onDownloadProgress, signal),
      promptOptions: {
        responseConstraint: buildStudyNotesJsonConstraint(
          takeawaysBounds,
          definitionsBounds,
        ),
      },
    },
  };
}

export function buildFlashcardsModelParams(
  policy: HybridRoutingPolicy,
  onDownloadProgress?: (percent: number) => void,
  cardBounds?: [number, number],
  signal?: AbortSignal,
): HybridParams {
  return {
    mode: resolveLocalFirstMode(policy),
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: buildFlashcardsSchema(cardBounds),
        temperature: 0.3,
      },
    },
    onDeviceParams: {
      createOptions: buildOnDeviceCreateOptions(onDownloadProgress, signal),
      promptOptions: {
        responseConstraint: buildFlashcardsJsonConstraint(cardBounds),
      },
    },
  };
}

export function buildQuizModelParams(questionCount?: number): HybridParams {
  return {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: buildQuizSchema(questionCount),
        temperature: 0.3,
      },
    },
  };
}

/**
 * Cloud parameters for single-call full-lecture study notes synthesis when
 * Gemini Nano is unavailable in Hybrid mode.
 */
export function buildFullLectureNotesCloudParams(
  targets?: StudyTargetCounts,
): HybridParams {
  const schema = targets
    ? buildStudyNotesSchema(
        [targets.takeawaysMin, targets.takeawaysMax],
        [targets.definitionsMin, targets.definitionsMax],
      )
    : studyNotesSchema;

  return {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.2,
      },
    },
  };
}

/**
 * Cloud parameters for single-call full-lecture flashcard synthesis when
 * Gemini Nano is unavailable in Hybrid mode.
 */
export function buildFullLectureFlashcardsCloudParams(
  cardBounds?: [number, number],
): HybridParams {
  return {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: buildFlashcardsSchema(cardBounds),
        temperature: 0.3,
      },
    },
  };
}

export function buildExplainModelParams(
  policy: HybridRoutingPolicy,
  onDownloadProgress?: (percent: number) => void,
  signal?: AbortSignal,
): HybridParams {
  return {
    mode: resolveLocalFirstMode(policy),
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: simpleExplanationSchema,
        temperature: 0.3,
      },
    },
    onDeviceParams: {
      createOptions: buildOnDeviceCreateOptions(onDownloadProgress, signal),
      promptOptions: {
        responseConstraint: SIMPLE_EXPLANATION_JSON_CONSTRAINT,
      },
    },
  };
}

export interface TelemetrySummary {
  localCount: number;
  cloudCount: number;
  avgLocalMs: number;
  avgCloudMs: number;
  onDevicePercent: number;
}

export function summarizeTelemetry(
  history: InferenceTelemetry[],
): TelemetrySummary {
  if (!history.length) {
    return {
      localCount: 0,
      cloudCount: 0,
      avgLocalMs: 0,
      avgCloudMs: 0,
      onDevicePercent: 0,
    };
  }

  const localCalls = history.filter((h) => h.source === 'ON_DEVICE');
  const cloudCalls = history.filter((h) => h.source === 'IN_CLOUD');

  const avg = (items: InferenceTelemetry[]) =>
    items.length
      ? Math.round(
          items.reduce((acc, item) => acc + item.latencyMs, 0) / items.length,
        )
      : 0;

  return {
    localCount: localCalls.length,
    cloudCount: cloudCalls.length,
    avgLocalMs: avg(localCalls),
    avgCloudMs: avg(cloudCalls),
    onDevicePercent: Math.round((localCalls.length / history.length) * 100),
  };
}

// --- Core Execution Wrapper ---

function trimForWindow(content: string, limit: number): string {
  const cleaned = content.trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit)}\n...[truncated at ${limit} characters]`;
}

function buildOnDeviceRecoveryError(rawError: unknown): HybridAiError {
  const detail = rawError instanceof Error ? rawError.message : String(rawError);
  return new HybridAiError(
    'ON_DEVICE_UNAVAILABLE',
    `Strict Local-Only mode requires Gemini Nano, which is not ready in Chrome (${detail}).`,
    'Enable chrome://flags/#optimization-guide-on-device-model and chrome://flags/#prompt-api-for-gemini-nano, verify download at chrome://on-device-internals, or switch to Hybrid (Auto) for seamless Cloud Gemini 3.8 Flash fallback.',
  );
}

export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\[429\s*\]|quota exceeded|rate[- ]limit|resource exhausted/i.test(
    message,
  );
}

export function extractRetryDelaySeconds(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match =
    /retry in\s+(\d+(?:\.\d+)?)s/i.exec(message) ??
    /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(message);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : null;
}

export function isTransientCloudError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\[(500|502|503|504)\s*\]|high demand|overloaded|temporarily unavailable/i.test(
    message,
  );
}

/**
 * Evenly samples 5 proportional spans (start through end) when a full lecture
 * exceeds `maxChars`, so Cloud Quiz covers the entire video without exceeding limits.
 */
export function sampleFullLectureForWindow(
  content: string,
  maxChars = FULL_LECTURE_CHAR_LIMIT,
): string {
  const cleaned = content.trim();
  if (cleaned.length <= maxChars) return cleaned;
  if (maxChars < 200) return cleaned.slice(0, maxChars);

  const lines = cleaned.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 10) {
    const spanCount = 5;
    const separator = '\n...\n';
    const budgetPerSpan = Math.floor(
      (maxChars - separator.length * (spanCount - 1)) / spanCount,
    );
    const step = Math.floor(
      (cleaned.length - budgetPerSpan) / Math.max(1, spanCount - 1),
    );
    const parts = Array.from({ length: spanCount }, (_, idx) => {
      const start = Math.min(idx * step, Math.max(0, cleaned.length - budgetPerSpan));
      return cleaned.slice(start, start + budgetPerSpan).trim();
    });
    return parts.join(separator).slice(0, maxChars);
  }

  const spanCount = 5;
  const separator = '\n...\n';
  const budgetPerSpan = Math.floor(
    (maxChars - separator.length * (spanCount - 1)) / spanCount,
  );
  const spans: string[] = [];

  for (let s = 0; s < spanCount; s++) {
    const startLineIdx = Math.floor((s * (lines.length - 1)) / (spanCount - 1));
    const anchor = s === spanCount - 1
      ? Math.max(0, lines.length - 1)
      : startLineIdx;

    const collected: string[] = [];
    let charSum = 0;

    if (s === spanCount - 1) {
      for (let i = anchor; i >= 0; i--) {
        const line = lines[i];
        if (charSum + line.length + 1 > budgetPerSpan && collected.length > 0) {
          break;
        }
        collected.unshift(line);
        charSum += line.length + 1;
      }
    } else {
      for (let i = anchor; i < lines.length; i++) {
        const line = lines[i];
        if (charSum + line.length + 1 > budgetPerSpan && collected.length > 0) {
          break;
        }
        collected.push(line);
        charSum += line.length + 1;
      }
    }

    spans.push(collected.join('\n'));
  }

  return spans.join(separator).slice(0, maxChars);
}

/**
 * Races an async AI call against an AbortSignal so cancelling or timing out
 * unblocks the UI immediately even if the underlying browser call hangs.
 */
function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  createAbortError: () => Error,
): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

async function runHybridTask<T>(
  task: StudyTaskKind,
  params: HybridParams,
  prompt: string,
  deps?: HybridInferenceDeps,
): Promise<{ parsed: T; telemetry: InferenceTelemetry }> {
  if (!deps?.ai && !deps?.modelFactory && !isFirebaseConfigured()) {
    throw new HybridAiError(
      'FIREBASE_NOT_CONFIGURED',
      'Firebase configuration is incomplete. Add your VITE_FIREBASE_* keys to .env and rebuild.',
      'If Gemini Nano is active in Chrome, you can switch to Local-Only mode or configure .env for Hybrid cloud fallback.',
    );
  }

  const ai = deps?.ai ?? getFirebaseAI();
  const factory =
    deps?.modelFactory ??
    ((instance: AI, modelParams: HybridParams) =>
      getGenerativeModel(instance, modelParams));
  const now = deps?.now ?? (() => performance.now());
  const sleep =
    deps?.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const startMs = now();

  const maxRetries = params.mode === InferenceMode.ONLY_ON_DEVICE ? 0 : 2;
  let result: GenerateContentResult | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (deps?.signal?.aborted) {
      throw new HybridAiError('ABORTED', 'Generation was cancelled.');
    }

    const attemptController = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => attemptController.abort();
    deps?.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const timeoutMs =
      params.mode !== InferenceMode.ONLY_IN_CLOUD
        ? (deps?.onDeviceTimeoutMs ?? ON_DEVICE_CALL_TIMEOUT_MS)
        : 0;
    const timeoutId =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            attemptController.abort();
          }, timeoutMs)
        : undefined;

    try {
      const effectiveParams: HybridParams = params.onDeviceParams
        ? {
            ...params,
            onDeviceParams: {
              ...params.onDeviceParams,
              createOptions: {
                ...params.onDeviceParams.createOptions,
                signal: attemptController.signal,
              },
            },
          }
        : params;
      const model = factory(ai, effectiveParams);
      result = await raceWithSignal(
        model.generateContent(prompt, { signal: attemptController.signal }),
        attemptController.signal,
        () =>
          timedOut
            ? new HybridAiError(
                'TIMEOUT',
                `On-device generation timed out during ${task}.`,
                'Select a single chapter for faster Gemini Nano runs, or switch to Hybrid (Auto) for fast Cloud Gemini synthesis.',
              )
            : new HybridAiError('ABORTED', 'Generation was cancelled.'),
      );
      break;
    } catch (error) {
      if (deps?.signal?.aborted) {
        throw new HybridAiError('ABORTED', 'Generation was cancelled.');
      }
      if (timedOut) {
        throw new HybridAiError(
          'TIMEOUT',
          `On-device generation timed out during ${task}.`,
          'Select a single chapter for faster Gemini Nano runs, or switch to Hybrid (Auto) for fast Cloud Gemini synthesis.',
        );
      }
      if (params.mode === InferenceMode.ONLY_ON_DEVICE) {
        throw buildOnDeviceRecoveryError(error);
      }

      if (isRateLimitError(error)) {
        const retrySecs = extractRetryDelaySeconds(error);
        const waitText = retrySecs ? `~${retrySecs}s` : 'about 30s';
        throw new HybridAiError(
          'RATE_LIMITED',
          `Cloud free-tier rate limit reached during ${task}. Please wait ${waitText} and try again.`,
          'Firebase Spark free tier allows 5 cloud requests/minute. Once Gemini Nano finishes downloading in Chrome, Notes and Flashcards run 100% locally with zero rate limits.',
        );
      }

      const transient = isTransientCloudError(error);
      if (transient && attempt < maxRetries) {
        await sleep(800 * (attempt + 1));
        continue;
      }

      const detail = error instanceof Error ? error.message : String(error);
      throw new HybridAiError(
        'INFERENCE_FAILED',
        `AI generation failed during ${task}: ${detail}`,
        transient
          ? 'The cloud Gemini model is temporarily busy due to high demand. Wait a few seconds and retry — once Gemini Nano finishes downloading, Notes and Flashcards run 100% on-device with zero cloud spikes.'
          : 'Check your network connection, Firebase AI Logic API enablement, and App Check debug token.',
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      deps?.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  if (deps?.signal?.aborted) {
    throw new HybridAiError('ABORTED', 'Generation was cancelled.');
  }

  if (!result) {
    throw new HybridAiError(
      'INFERENCE_FAILED',
      `AI generation failed during ${task}: No response received.`,
    );
  }

  const latencyMs = Math.max(0, now() - startMs);
  const source = normalizeInferenceSource(
    result.response.inferenceSource,
    params.mode,
  );
  const parsed = parseStructuredJson<T>(result.response.text());

  const telemetry: InferenceTelemetry = {
    source,
    latencyMs,
    task,
    modelLabel: source === 'ON_DEVICE' ? 'Gemini Nano' : CLOUD_MODEL_NAME,
    timestamp: Date.now(),
  };

  return { parsed, telemetry };
}

function normalizeNotesPayload(parsed: StudyNotesData): StudyNotesData {
  return {
    overview: (parsed.overview ?? '').trim(),
    takeaways: Array.isArray(parsed.takeaways)
      ? parsed.takeaways
          .filter((item) => item && item.point)
          .map((item) => normalizeTimestampFields(item))
          .sort((a, b) => a.startSeconds - b.startSeconds)
      : [],
    definitions: Array.isArray(parsed.definitions)
      ? parsed.definitions
          .filter((item) => item && item.term && item.definition)
          .map((item) => normalizeTimestampFields(item))
          .sort((a, b) => a.startSeconds - b.startSeconds)
      : [],
  };
}

function normalizeFlashcardsPayload(
  parsed: FlashcardsData,
  idPrefix = '',
): FlashcardsData {
  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const cards: Flashcard[] = rawCards
    .filter((c) => c && c.front && c.back)
    .map((card, idx) => {
      const rawId = (card.id ?? '').trim() || `card-${idx + 1}`;
      return {
        ...normalizeTimestampFields(card),
        id: idPrefix ? `${idPrefix}${rawId}` : rawId,
      };
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);
  return { cards };
}

function buildMapReduceChunks(
  chunks: TranscriptChunk[],
  fullText: string,
): TranscriptChunk[] {
  if (chunks.length > 0) {
    return selectRepresentativeChunks(chunks, MAX_ON_DEVICE_CHAPTERS);
  }
  const cleaned = fullText.trim();
  const plainChunks: TranscriptChunk[] = [];
  for (let offset = 0; offset < cleaned.length; offset += ON_DEVICE_CHAR_LIMIT) {
    const slice = cleaned.slice(offset, offset + ON_DEVICE_CHAR_LIMIT);
    const idx = plainChunks.length + 1;
    plainChunks.push({
      id: `chunk-${idx}`,
      label: `Part ${idx}`,
      startTimestamp: '00:00',
      endTimestamp: '00:00',
      startSeconds: 0,
      endSeconds: 0,
      charCount: slice.length,
      text: slice,
      segments: [],
    });
  }
  return selectRepresentativeChunks(plainChunks, MAX_ON_DEVICE_CHAPTERS);
}

// --- Public Hybrid AI Operations ---

export async function extractStudyNotes(
  content: string,
  policy: HybridRoutingPolicy,
  deps?: HybridInferenceDeps,
): Promise<HybridCallResult<StudyNotesData>> {
  const prepared = trimForWindow(content, ON_DEVICE_CHAR_LIMIT);
  if (!prepared) {
    throw new HybridAiError(
      'EMPTY_CONTENT',
      'Capture a YouTube transcript or paste study text first.',
    );
  }

  const [takeawaysMin, takeawaysMax] = deps?.targetTakeaways ?? [4, 6];
  const [definitionsMin, definitionsMax] = deps?.targetDefinitions ?? [3, 6];
  const effectiveTakeawaysBounds: [number, number] = [
    clampMinForLength(takeawaysMin, prepared.length),
    takeawaysMax,
  ];
  const effectiveDefinitionsBounds: [number, number] = [
    clampMinForLength(definitionsMin, prepared.length),
    definitionsMax,
  ];

  const prompt = [
    'You are an academic study assistant. Analyze the timestamped lecture or article excerpt below.',
    'Return ONLY valid JSON matching the requested schema:',
    '- overview: concise 1-2 sentence summary.',
    `- takeaways: ${effectiveTakeawaysBounds[0]} to ${effectiveTakeawaysBounds[1]} key takeaways, each citing the closest [mm:ss] timestamp and integer startSeconds.`,
    `- definitions: ${effectiveDefinitionsBounds[0]} to ${effectiveDefinitionsBounds[1]} important technical terms with clear definitions and closest timestamp.`,
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'SOURCE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<StudyNotesData>(
    'notes',
    buildNotesModelParams(
      policy,
      deps?.onDownloadProgress,
      effectiveTakeawaysBounds,
      effectiveDefinitionsBounds,
    ),
    prompt,
    deps,
  );

  return { data: normalizeNotesPayload(parsed), telemetry };
}

/**
 * Extracts study notes across the full lecture using on-device chapter
 * map-reduce when Gemini Nano is ready (or Local-Only), or a single full-lecture
 * Cloud call when falling back in Hybrid mode.
 */
export async function extractFullLectureStudyNotes(
  chunks: TranscriptChunk[],
  fullText: string,
  policy: HybridRoutingPolicy,
  deps?: HybridInferenceDeps,
): Promise<HybridCallResult<StudyNotesData>> {
  const cleaned = fullText.trim();
  if (!cleaned) {
    throw new HybridAiError(
      'EMPTY_CONTENT',
      'Capture a YouTube transcript or paste study text first.',
    );
  }

  if (cleaned.length <= ON_DEVICE_CHAR_LIMIT) {
    return extractStudyNotes(cleaned, policy, deps);
  }

  const availability =
    policy === 'local-only'
      ? 'available'
      : await (deps?.checkAvailability ?? checkOnDeviceAvailability)();

  if (policy === 'local-only' || availability === 'available') {
    const workChunks = buildMapReduceChunks(chunks, cleaned);
    const shouldOffloadToCloud =
      policy === 'hybrid' && workChunks.length > HYBRID_ON_DEVICE_MAX_CHAPTERS;

    if (!shouldOffloadToCloud) {
      let merged: StudyNotesData | undefined;
      let totalLatencyMs = 0;
      let anyLocal = false;
      let fellBackToCloud = false;

      for (let i = 0; i < workChunks.length; i++) {
        if (deps?.signal?.aborted) {
          throw new HybridAiError('ABORTED', 'Generation was cancelled.');
        }
        const chunk = workChunks[i];
        deps?.onChapterProgress?.(i + 1, workChunks.length, chunk.label);

        try {
          const res = await extractStudyNotes(chunk.text, policy, {
            ...deps,
            targetTakeaways:
              chunk.charCount >= 1800
                ? [3, 4]
                : chunk.charCount >= 600
                  ? [2, 3]
                  : [1, 2],
            targetDefinitions: chunk.charCount >= 1800 ? [2, 3] : [1, 2],
          });

          totalLatencyMs += res.telemetry.latencyMs;
          if (res.telemetry.source === 'ON_DEVICE') {
            anyLocal = true;
          }

          if (
            policy === 'hybrid' &&
            i === 0 &&
            workChunks.length > 1 &&
            res.telemetry.source === 'IN_CLOUD'
          ) {
            fellBackToCloud = true;
            break;
          }

          merged = mergeStudyNotes(merged, res.data);
          deps?.onPartialNotes?.(merged, i + 1, workChunks.length);
        } catch (error) {
          if (error instanceof HybridAiError && error.code === 'ABORTED') {
            throw error;
          }
          if (error instanceof HybridAiError && error.code === 'TIMEOUT') {
            if (policy === 'hybrid') {
              fellBackToCloud = true;
              break;
            }
            if (merged) {
              continue;
            }
          }
          throw error;
        }
      }

      if (!fellBackToCloud && merged) {
        return {
          data: merged,
          telemetry: {
            source: anyLocal ? 'ON_DEVICE' : 'IN_CLOUD',
            latencyMs: totalLatencyMs,
            task: 'notes',
            modelLabel: anyLocal ? 'Gemini Nano' : CLOUD_MODEL_NAME,
            timestamp: Date.now(),
          },
        };
      }
    }
  }

  const prepared = sampleFullLectureForWindow(cleaned, FULL_LECTURE_CHAR_LIMIT);
  const targets = computeTargetCounts(cleaned.length);
  const prompt = [
    'You are an academic study assistant. Analyze the full timestamped lecture or article below.',
    'Return ONLY valid JSON matching the requested schema:',
    '- overview: concise 2-3 sentence synthesis covering the entire lecture.',
    `- takeaways: ${targets.takeawaysMin} to ${targets.takeawaysMax} key takeaways distributed evenly from beginning to end, each citing the closest [mm:ss] timestamp and integer startSeconds.`,
    `- definitions: ${targets.definitionsMin} to ${targets.definitionsMax} important technical terms across the full lecture with clear definitions and closest timestamp.`,
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'FULL LECTURE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<StudyNotesData>(
    'notes',
    buildFullLectureNotesCloudParams(targets),
    prompt,
    deps,
  );

  return { data: normalizeNotesPayload(parsed), telemetry };
}

export async function generateFlashcards(
  content: string,
  policy: HybridRoutingPolicy,
  deps?: HybridInferenceDeps,
): Promise<HybridCallResult<FlashcardsData>> {
  const prepared = trimForWindow(content, ON_DEVICE_CHAR_LIMIT);
  if (!prepared) {
    throw new HybridAiError(
      'EMPTY_CONTENT',
      'Capture a YouTube transcript or paste study text first.',
    );
  }

  const [cardsMin, cardsMax] = deps?.targetFlashcards ?? [5, 8];
  const effectiveMin = clampMinForLength(cardsMin, prepared.length);
  const effectiveCardBounds: [number, number] = [effectiveMin, cardsMax];

  const prompt = [
    `You are an active-recall learning coach. Create ${effectiveMin} to ${cardsMax} distinct high-yield flashcards (at least ${effectiveMin} cards covering different concepts and timestamps) from the excerpt below.`,
    'Return ONLY valid JSON with a "cards" array.',
    'Each card must have: id, front (specific active-recall question), back (concise 1-3 sentence answer), timestamp (mm:ss), startSeconds (integer).',
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'SOURCE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<FlashcardsData>(
    'flashcards',
    buildFlashcardsModelParams(
      policy,
      deps?.onDownloadProgress,
      effectiveCardBounds,
    ),
    prompt,
    deps,
  );

  return {
    data: normalizeFlashcardsPayload(parsed, deps?.idPrefix),
    telemetry,
  };
}

/**
 * Generates active-recall flashcards across the full lecture using on-device
 * chapter map-reduce when Gemini Nano is ready (or Local-Only), or a single
 * full-lecture Cloud call when falling back in Hybrid mode.
 */
export async function generateFullLectureFlashcards(
  chunks: TranscriptChunk[],
  fullText: string,
  policy: HybridRoutingPolicy,
  deps?: HybridInferenceDeps,
): Promise<HybridCallResult<FlashcardsData>> {
  const cleaned = fullText.trim();
  if (!cleaned) {
    throw new HybridAiError(
      'EMPTY_CONTENT',
      'Capture a YouTube transcript or paste study text first.',
    );
  }

  if (cleaned.length <= ON_DEVICE_CHAR_LIMIT) {
    return generateFlashcards(cleaned, policy, deps);
  }

  const availability =
    policy === 'local-only'
      ? 'available'
      : await (deps?.checkAvailability ?? checkOnDeviceAvailability)();

  if (policy === 'local-only' || availability === 'available') {
    const workChunks = buildMapReduceChunks(chunks, cleaned);
    const shouldOffloadToCloud =
      policy === 'hybrid' && workChunks.length > HYBRID_ON_DEVICE_MAX_CHAPTERS;

    if (shouldOffloadToCloud) {
      const distilledText = deps?.distilledNotes
        ? formatNotesForOnDeviceDistillation(deps.distilledNotes)
        : '';
      if (distilledText) {
        try {
          return await generateFlashcards(distilledText, 'hybrid', {
            ...deps,
            targetFlashcards: [6, 8],
          });
        } catch (error) {
          if (error instanceof HybridAiError && error.code === 'ABORTED') {
            throw error;
          }
          // Fall through to full-lecture Cloud synthesis if Nano times out or fails
        }
      }
    } else {
      let merged: FlashcardsData | undefined;
      let totalLatencyMs = 0;
      let anyLocal = false;
      let fellBackToCloud = false;

      for (let i = 0; i < workChunks.length; i++) {
        if (deps?.signal?.aborted) {
          throw new HybridAiError('ABORTED', 'Generation was cancelled.');
        }
        const chunk = workChunks[i];
        deps?.onChapterProgress?.(i + 1, workChunks.length, chunk.label);

        try {
          const res = await generateFlashcards(chunk.text, policy, {
            ...deps,
            targetFlashcards:
              chunk.charCount >= 1800
                ? [3, 4]
                : chunk.charCount >= 600
                  ? [2, 3]
                  : [1, 2],
            idPrefix: `${chunk.id}-`,
          });

          totalLatencyMs += res.telemetry.latencyMs;
          if (res.telemetry.source === 'ON_DEVICE') {
            anyLocal = true;
          }

          if (
            policy === 'hybrid' &&
            i === 0 &&
            workChunks.length > 1 &&
            res.telemetry.source === 'IN_CLOUD'
          ) {
            fellBackToCloud = true;
            break;
          }

          merged = mergeFlashcards(merged, res.data);
          deps?.onPartialFlashcards?.(merged, i + 1, workChunks.length);
        } catch (error) {
          if (error instanceof HybridAiError && error.code === 'ABORTED') {
            throw error;
          }
          if (error instanceof HybridAiError && error.code === 'TIMEOUT') {
            if (policy === 'hybrid') {
              fellBackToCloud = true;
              break;
            }
            if (merged) {
              continue;
            }
          }
          throw error;
        }
      }

      if (!fellBackToCloud && merged) {
        return {
          data: merged,
          telemetry: {
            source: anyLocal ? 'ON_DEVICE' : 'IN_CLOUD',
            latencyMs: totalLatencyMs,
            task: 'flashcards',
            modelLabel: anyLocal ? 'Gemini Nano' : CLOUD_MODEL_NAME,
            timestamp: Date.now(),
          },
        };
      }
    }
  }

  const prepared = sampleFullLectureForWindow(cleaned, FULL_LECTURE_CHAR_LIMIT);
  const targets = computeTargetCounts(cleaned.length);
  const prompt = [
    `You are an active-recall learning coach. Create ${targets.flashcardsMin} to ${targets.flashcardsMax} high-yield flashcards covering the entire lecture from start to end.`,
    'Return ONLY valid JSON with a "cards" array.',
    'Each card must have: id, front (specific active-recall question), back (concise 1-3 sentence answer), timestamp (mm:ss), startSeconds (integer).',
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'FULL LECTURE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<FlashcardsData>(
    'flashcards',
    buildFullLectureFlashcardsCloudParams([
      targets.flashcardsMin,
      targets.flashcardsMax,
    ]),
    prompt,
    deps,
  );

  return { data: normalizeFlashcardsPayload(parsed), telemetry };
}

export async function generatePracticeQuiz(
  content: string,
  deps?: HybridInferenceDeps,
): Promise<HybridCallResult<QuizData>> {
  const cleaned = content.trim();
  const prepared = sampleFullLectureForWindow(cleaned, FULL_LECTURE_CHAR_LIMIT);
  if (!prepared) {
    throw new HybridAiError(
      'EMPTY_CONTENT',
      'Capture a YouTube transcript or paste study text first.',
    );
  }

  const targetCount = Math.min(
    15,
    Math.max(5, deps?.questionCount ?? computeTargetCounts(cleaned.length).quizCount),
  );

  const prompt = [
    'You are a university instructor creating a comprehensive assessment across the full lecture below.',
    `Return ONLY valid JSON with a "questions" array of EXACTLY ${targetCount} multiple-choice questions distributed evenly across all sections and chapters.`,
    'Each question must include: id, question, options (array of 4 distinct choices), correctIndex (integer 0-3), explanation (why the answer is right), timestamp (mm:ss), and startSeconds (integer).',
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'FULL LECTURE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<QuizData>(
    'quiz',
    buildQuizModelParams(targetCount),
    prompt,
    deps,
  );

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions: QuizQuestion[] = rawQuestions
    .filter((q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2)
    .slice(0, targetCount)
    .map((q, idx) => {
      const options = q.options.slice(0, 4);
      const rawIdx = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
      const correctIndex = Math.min(Math.max(0, rawIdx), options.length - 1);
      return {
        ...normalizeTimestampFields(q),
        id: (q.id ?? '').trim() || `q-${idx + 1}`,
        options,
        correctIndex,
        explanation: (q.explanation ?? '').trim(),
      };
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);

  return { data: { questions }, telemetry };
}

/**
 * Cloud -> On-Device Tutor Loop:
 * Takes a hard definition or missed Cloud Quiz concept and generates a quick
 * plain-English analogy + key idea on-device (or Cloud fallback in Hybrid mode).
 */
export async function explainConceptSimply(
  concept: string,
  context: string,
  policy: HybridRoutingPolicy,
  deps?: HybridInferenceDeps,
): Promise<HybridCallResult<SimpleExplanation>> {
  const cleanConcept = concept.trim();
  const cleanContext = trimForWindow(context, 2500);
  if (!cleanConcept) {
    throw new HybridAiError(
      'EMPTY_CONTENT',
      'No concept was provided to explain.',
    );
  }

  const prompt = [
    'You are a friendly peer tutor. Explain the concept below in plain, intuitive language.',
    'Return ONLY valid JSON with:',
    '- analogy: 1-2 sentence everyday analogy making the concept click.',
    '- keyIdea: 1 crisp takeaway sentence summarizing why it matters.',
    '',
    `CONCEPT: ${cleanConcept}`,
    cleanContext ? `CONTEXT:\n${cleanContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { parsed, telemetry } = await runHybridTask<SimpleExplanation>(
    'explain',
    buildExplainModelParams(policy, deps?.onDownloadProgress),
    prompt,
    deps,
  );

  return {
    data: {
      analogy: (parsed.analogy ?? '').trim(),
      keyIdea: (parsed.keyIdea ?? '').trim(),
    },
    telemetry,
  };
}

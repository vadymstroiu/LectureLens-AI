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
import {
  formatTimestamp,
  parseTimestampToSeconds,
} from '../content/youtubeTranscriptParser';
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
export const CLOUD_MODEL_NAME =
  (import.meta.env.VITE_FIREBASE_CLOUD_MODEL ?? '').trim() ||
  'gemini-3.8-flash';

export type HybridAiErrorCode =
  | 'ON_DEVICE_UNAVAILABLE'
  | 'FIREBASE_NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'EMPTY_CONTENT'
  | 'INVALID_RESPONSE'
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

export interface HybridInferenceDeps {
  ai?: AI;
  modelFactory?: (ai: AI, params: HybridParams) => Pick<GenerativeModel, 'generateContent'>;
  now?: () => number;
  onDownloadProgress?: (percent: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

interface ChromeLanguageModelGlobal {
  LanguageModel?: {
    availability?: () => Promise<string>;
    create?: (options?: {
      monitor?: (m: {
        addEventListener: (
          eventType: 'downloadprogress',
          listener: (e: { loaded: number }) => void,
        ) => void;
      }) => void;
    }) => Promise<{ destroy?: () => void }>;
  };
}

// --- Structured Output Schemas (firebase/ai Schema) ---

export const studyNotesSchema = Schema.object({
  properties: {
    overview: Schema.string({
      description: 'Two-sentence synthesis of the lecture section.',
    }),
    takeaways: Schema.array({
      description: '4 to 6 key takeaways anchored to transcript timestamps.',
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
      description: '3 to 6 core terms and concise definitions.',
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

export const flashcardsSchema = Schema.object({
  properties: {
    cards: Schema.array({
      description: '5 to 8 active-recall study flashcards.',
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

export const quizSchema = Schema.object({
  properties: {
    questions: Schema.array({
      description: 'Exactly 5 multiple-choice practice questions.',
      items: Schema.object({
        properties: {
          id: Schema.string(),
          question: Schema.string(),
          options: Schema.array({
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
const STUDY_NOTES_JSON_CONSTRAINT = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    takeaways: {
      type: 'array',
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

const FLASHCARDS_JSON_CONSTRAINT = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
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
    const status = await api.availability();
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
  return `${(latencyMs / 1000).toFixed(1)}s`;
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
 * Explicitly initiates/monitors Chrome's Gemini Nano download from a user click.
 */
export async function triggerOnDeviceDownload(
  onProgress: (percent: number) => void,
): Promise<OnDeviceAvailability> {
  const api = (globalThis as unknown as ChromeLanguageModelGlobal).LanguageModel;
  if (!api?.create) {
    return checkOnDeviceAvailability();
  }

  const session = await api.create({
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
) {
  return {
    expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
    expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
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
): HybridParams {
  return {
    mode: resolveLocalFirstMode(policy),
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: studyNotesSchema,
        temperature: 0.2,
      },
    },
    onDeviceParams: {
      createOptions: buildOnDeviceCreateOptions(onDownloadProgress),
      promptOptions: {
        responseConstraint: STUDY_NOTES_JSON_CONSTRAINT,
      },
    },
  };
}

export function buildFlashcardsModelParams(
  policy: HybridRoutingPolicy,
  onDownloadProgress?: (percent: number) => void,
): HybridParams {
  return {
    mode: resolveLocalFirstMode(policy),
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: flashcardsSchema,
        temperature: 0.3,
      },
    },
    onDeviceParams: {
      createOptions: buildOnDeviceCreateOptions(onDownloadProgress),
      promptOptions: {
        responseConstraint: FLASHCARDS_JSON_CONSTRAINT,
      },
    },
  };
}

export function buildQuizModelParams(): HybridParams {
  return {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: quizSchema,
        temperature: 0.3,
      },
    },
  };
}

export function buildExplainModelParams(
  policy: HybridRoutingPolicy,
  onDownloadProgress?: (percent: number) => void,
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
      createOptions: buildOnDeviceCreateOptions(onDownloadProgress),
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

  const model = factory(ai, params);
  const startMs = now();

  const maxRetries = params.mode === InferenceMode.ONLY_ON_DEVICE ? 0 : 2;
  let result: GenerateContentResult | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (error) {
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
    }
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

function normalizeTimestampFields<
  T extends { timestamp?: string; startSeconds?: number },
>(item: T): T & { timestamp: string; startSeconds: number } {
  const ts = (item.timestamp ?? '').trim();
  const hasNumeric =
    typeof item.startSeconds === 'number' && Number.isFinite(item.startSeconds);
  const startSeconds = hasNumeric
    ? Math.max(0, Math.floor(item.startSeconds!))
    : parseTimestampToSeconds(ts);
  const timestamp = ts || formatTimestamp(startSeconds);
  return {
    ...item,
    timestamp,
    startSeconds,
  };
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

  const prompt = [
    'You are an academic study assistant. Analyze the timestamped lecture or article excerpt below.',
    'Return ONLY valid JSON matching the requested schema:',
    '- overview: concise 1-2 sentence summary.',
    '- takeaways: 4 to 6 key takeaways, each citing the closest [mm:ss] timestamp and integer startSeconds.',
    '- definitions: 3 to 6 important technical terms with clear definitions and closest timestamp.',
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'SOURCE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<StudyNotesData>(
    'notes',
    buildNotesModelParams(policy, deps?.onDownloadProgress),
    prompt,
    deps,
  );

  const normalized: StudyNotesData = {
    overview: (parsed.overview ?? '').trim(),
    takeaways: Array.isArray(parsed.takeaways)
      ? parsed.takeaways
          .filter((item) => item && item.point)
          .map((item) => normalizeTimestampFields(item))
      : [],
    definitions: Array.isArray(parsed.definitions)
      ? parsed.definitions
          .filter((item) => item && item.term && item.definition)
          .map((item) => normalizeTimestampFields(item))
      : [],
  };

  return { data: normalized, telemetry };
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

  const prompt = [
    'You are an active-recall learning coach. Create 5 to 8 high-yield flashcards from the excerpt below.',
    'Return ONLY valid JSON with a "cards" array.',
    'Each card must have: id, front (specific active-recall question), back (concise 1-3 sentence answer), timestamp (mm:ss), startSeconds (integer).',
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'SOURCE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<FlashcardsData>(
    'flashcards',
    buildFlashcardsModelParams(policy, deps?.onDownloadProgress),
    prompt,
    deps,
  );

  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const cards: Flashcard[] = rawCards
    .filter((c) => c && c.front && c.back)
    .map((card, idx) => ({
      ...normalizeTimestampFields(card),
      id: (card.id ?? '').trim() || `card-${idx + 1}`,
    }));

  return { data: { cards }, telemetry };
}

export async function generatePracticeQuiz(
  content: string,
  deps?: HybridInferenceDeps,
): Promise<HybridCallResult<QuizData>> {
  const prepared = sampleFullLectureForWindow(content, FULL_LECTURE_CHAR_LIMIT);
  if (!prepared) {
    throw new HybridAiError(
      'EMPTY_CONTENT',
      'Capture a YouTube transcript or paste study text first.',
    );
  }

  const prompt = [
    'You are a university instructor creating a comprehensive assessment across the full lecture below.',
    'Return ONLY valid JSON with a "questions" array of EXACTLY 5 multiple-choice questions.',
    'Each question must include: id, question, options (array of 4 distinct choices), correctIndex (integer 0-3), explanation (why the answer is right), timestamp (mm:ss), and startSeconds (integer).',
    'If no timestamps appear in the source text, use "00:00" and 0.',
    '',
    'FULL LECTURE CONTENT:',
    prepared,
  ].join('\n');

  const { parsed, telemetry } = await runHybridTask<QuizData>(
    'quiz',
    buildQuizModelParams(),
    prompt,
    deps,
  );

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions: QuizQuestion[] = rawQuestions
    .filter((q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2)
    .slice(0, 5)
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
    });

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

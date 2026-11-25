import { describe, expect, it, vi } from 'vitest';
import {
  InferenceMode,
  InferenceSource,
  type AI,
  type GenerateContentResult,
  type HybridParams,
} from 'firebase/ai';
import {
  analyzeContentWindow,
  buildFlashcardsModelParams,
  buildNotesModelParams,
  buildQuizModelParams,
  chunkTranscriptSegments,
  CLOUD_MODEL_NAME,
  extractStudyNotes,
  formatLatency,
  generateFlashcards,
  generatePracticeQuiz,
  HybridAiError,
  ON_DEVICE_CHAR_LIMIT,
  parseStructuredJson,
  resolveLocalFirstMode,
} from '../hybridAi';
import {
  extractCaptionTrackUrlFromHtml,
  extractVideoId,
  formatTimestamp,
  parseJson3Captions,
  parseTranscriptDomRow,
  parseXmlCaptions,
} from '../../content/youtubeTranscriptParser';
import {
  escapeCsvField,
  formatAnkiCsv,
  formatStudyMarkdown,
} from '../../sidepanel/exporters';
import type { LectureSession } from '../../types/lecture';

const MOCK_AI = {} as AI;

function createMockResult(
  payload: unknown,
  inferenceSource?: InferenceSource,
): GenerateContentResult {
  return {
    response: {
      text: () => JSON.stringify(payload),
      inferenceSource,
    },
  } as unknown as GenerateContentResult;
}

describe('Hybrid AI routing & model configuration', () => {
  it('routes Notes and Flashcards to PREFER_ON_DEVICE in hybrid mode and ONLY_ON_DEVICE in local-only mode', () => {
    expect(resolveLocalFirstMode('hybrid')).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(resolveLocalFirstMode('local-only')).toBe(
      InferenceMode.ONLY_ON_DEVICE,
    );

    const notesHybrid = buildNotesModelParams('hybrid');
    expect(notesHybrid.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(notesHybrid.inCloudParams?.model).toBe(CLOUD_MODEL_NAME);
    expect(notesHybrid.inCloudParams?.generationConfig?.responseMimeType).toBe(
      'application/json',
    );
    expect(
      notesHybrid.inCloudParams?.generationConfig?.responseSchema,
    ).toBeDefined();
    expect(notesHybrid.onDeviceParams?.promptOptions?.responseConstraint).toBeDefined();

    const cardsLocal = buildFlashcardsModelParams('local-only');
    expect(cardsLocal.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(cardsLocal.inCloudParams?.model).toBe(CLOUD_MODEL_NAME);
  });

  it('routes Practice Quiz strictly to ONLY_IN_CLOUD with gemini-3.8-flash and JSON schema', () => {
    const quizParams = buildQuizModelParams();
    expect(quizParams.mode).toBe(InferenceMode.ONLY_IN_CLOUD);
    expect(quizParams.inCloudParams?.model).toBe(CLOUD_MODEL_NAME);
    expect(quizParams.inCloudParams?.generationConfig?.responseMimeType).toBe(
      'application/json',
    );
    expect(
      quizParams.inCloudParams?.generationConfig?.responseSchema,
    ).toBeDefined();
  });

  it('records ON_DEVICE telemetry and latency when Gemini Nano fulfills extractStudyNotes', async () => {
    let capturedParams: HybridParams | undefined;
    let tick = 1000;

    const mockNotes = {
      overview: 'Overview of hybrid edge inference.',
      takeaways: [
        {
          point: 'Gemini Nano executes locally in Chrome.',
          timestamp: '00:38',
          startSeconds: 38,
        },
      ],
      definitions: [
        {
          term: 'Hybrid Inference',
          definition: 'Routing between local and cloud models.',
          timestamp: '03:44',
          startSeconds: 224,
        },
      ],
    };

    const result = await extractStudyNotes('[00:38] Sample lecture text', 'hybrid', {
      ai: MOCK_AI,
      now: () => {
        const current = tick;
        tick += 380;
        return current;
      },
      modelFactory: (_ai, params) => {
        capturedParams = params;
        return {
          generateContent: vi
            .fn()
            .mockResolvedValue(
              createMockResult(mockNotes, InferenceSource.ON_DEVICE),
            ),
        };
      },
    });

    expect(capturedParams?.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(capturedParams?.inCloudParams?.model).toBe(CLOUD_MODEL_NAME);
    expect(result.telemetry.source).toBe('ON_DEVICE');
    expect(result.telemetry.modelLabel).toBe('Gemini Nano');
    expect(result.telemetry.latencyMs).toBe(380);
    expect(result.data.takeaways).toHaveLength(1);
    expect(result.data.definitions[0].term).toBe('Hybrid Inference');
  });

  it('records IN_CLOUD fallback telemetry for flashcards when Nano is unavailable in hybrid mode', async () => {
    let tick = 200;
    const mockCards = {
      cards: [
        {
          id: 'c1',
          front: 'What mode enables automatic cloud fallback?',
          back: 'InferenceMode.PREFER_ON_DEVICE with inCloudParams.',
          timestamp: '03:44',
          startSeconds: 224,
        },
      ],
    };

    const result = await generateFlashcards('[03:44] Hybrid routing', 'hybrid', {
      ai: MOCK_AI,
      now: () => {
        const current = tick;
        tick += 1620;
        return current;
      },
      modelFactory: () => ({
        generateContent: vi
          .fn()
          .mockResolvedValue(
            createMockResult(mockCards, InferenceSource.IN_CLOUD),
          ),
      }),
    });

    expect(result.telemetry.source).toBe('IN_CLOUD');
    expect(result.telemetry.modelLabel).toBe(CLOUD_MODEL_NAME);
    expect(result.telemetry.latencyMs).toBe(1620);
    expect(formatLatency(result.telemetry.latencyMs)).toBe('1.6s');
    expect(result.data.cards[0].id).toBe('c1');
  });

  it('enforces Strict Local-Only policy and surfaces actionable Nano recovery hint on failure', async () => {
    await expect(
      extractStudyNotes('[00:00] Local-only test', 'local-only', {
        ai: MOCK_AI,
        modelFactory: () => ({
          generateContent: vi
            .fn()
            .mockRejectedValue(new Error('On-device model not downloaded')),
        }),
      }),
    ).rejects.toMatchObject({
      name: 'HybridAiError',
      code: 'ON_DEVICE_UNAVAILABLE',
      recoveryHint: expect.stringContaining('chrome://flags/#prompt-api-for-gemini-nano'),
    });
  });

  it('executes generatePracticeQuiz in ONLY_IN_CLOUD mode and normalizes up to 5 questions', async () => {
    let capturedParams: HybridParams | undefined;
    const mockQuiz = {
      questions: Array.from({ length: 6 }, (_, i) => ({
        id: `q-${i + 1}`,
        question: `Question ${i + 1}`,
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 1,
        explanation: 'Explanation',
        timestamp: '01:00',
        startSeconds: 60,
      })),
    };

    const result = await generatePracticeQuiz('Full lecture transcript', {
      ai: MOCK_AI,
      modelFactory: (_ai, params) => {
        capturedParams = params;
        return {
          generateContent: vi
            .fn()
            .mockResolvedValue(
              createMockResult(mockQuiz, InferenceSource.IN_CLOUD),
            ),
        };
      },
    });

    expect(capturedParams?.mode).toBe(InferenceMode.ONLY_IN_CLOUD);
    expect(result.telemetry.source).toBe('IN_CLOUD');
    expect(result.data.questions).toHaveLength(5);
  });

  it('parses fenced JSON safely and throws HybridAiError on malformed JSON', () => {
    const parsed = parseStructuredJson<{ ok: boolean }>(
      '```json\n{"ok": true}\n```',
    );
    expect(parsed.ok).toBe(true);

    expect(() => parseStructuredJson('not json at all')).toThrow(HybridAiError);
  });
});

describe('Content window analysis & transcript chunking', () => {
  it('classifies short vs long content against the 6,000 char on-device window', () => {
    const shortAnalysis = analyzeContentWindow('a'.repeat(500));
    expect(shortAnalysis.fitsOnDevice).toBe(true);
    expect(shortAnalysis.recommendedEngine).toBe('ON_DEVICE');
    expect(shortAnalysis.hint).toContain('Gemini Nano');

    const longAnalysis = analyzeContentWindow(
      'a'.repeat(ON_DEVICE_CHAR_LIMIT + 1),
    );
    expect(longAnalysis.fitsOnDevice).toBe(false);
    expect(longAnalysis.recommendedEngine).toBe('IN_CLOUD');
    expect(longAnalysis.hint).toContain('Cloud Quiz');
  });

  it('splits long timestamped segments into <= 6,000 char chunks', () => {
    const segments = Array.from({ length: 80 }, (_, idx) => ({
      startSeconds: idx * 15,
      timestamp: formatTimestamp(idx * 15),
      text: 'x'.repeat(140),
    }));

    const chunks = chunkTranscriptSegments(segments, 2000);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.charCount).toBeLessThanOrEqual(2000);
    }
  });
});

describe('Markdown & Anki CSV exporters', () => {
  const sampleSession: LectureSession = {
    sourceId: 'yt:abc123',
    content: {
      sourceId: 'yt:abc123',
      sourceType: 'youtube',
      title: 'Hybrid AI Deep Dive',
      url: 'https://www.youtube.com/watch?v=abc123',
      segments: [],
      rawText: 'Transcript',
      capturedAt: 1000,
    },
    notes: {
      overview: 'Covers local and cloud routing.',
      takeaways: [
        {
          point: 'Use PREFER_ON_DEVICE for low latency.',
          timestamp: '01:15',
          startSeconds: 75,
        },
      ],
      definitions: [
        {
          term: 'App Check',
          definition: 'Verifies genuine client traffic.',
          timestamp: '02:30',
          startSeconds: 150,
        },
      ],
    },
    flashcards: {
      cards: [
        {
          id: 'c1',
          front: 'What is "App Check", and why use it?',
          back: 'Protects Firebase backends from abuse\nacross clients.',
          timestamp: '02:30',
          startSeconds: 150,
        },
      ],
    },
    masteredCardIds: [],
    quizAnswers: {},
    telemetryHistory: [],
    updatedAt: 1000,
  };

  it('formats study Markdown with clickable timestamp notation and flashcards', () => {
    const md = formatStudyMarkdown(sampleSession);
    expect(md).toContain('# Hybrid AI Deep Dive');
    expect(md).toContain('- [01:15] Use PREFER_ON_DEVICE for low latency.');
    expect(md).toContain('- **App Check** (02:30): Verifies genuine client traffic.');
    expect(md).toContain('**Q:** What is "App Check", and why use it?');
    expect(md).toContain('[02:30]');
  });

  it('escapes commas, quotes, and newlines in RFC-4180 Anki CSV export', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a, "b"\nc')).toBe('"a, ""b""\nc"');

    const csv = formatAnkiCsv(sampleSession.flashcards!.cards);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('front,back');
    expect(csv).toContain('"What is ""App Check"", and why use it?"');
    expect(csv).toContain(
      '"Protects Firebase backends from abuse\nacross clients. [02:30]"',
    );
  });
});

describe('YouTube transcript & URL parsers', () => {
  it('extracts YouTube IDs across watch, shorts, live, and youtu.be URLs', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(extractVideoId('https://youtu.be/abc123XYZ')).toBe('abc123XYZ');
    expect(extractVideoId('https://www.youtube.com/shorts/short99')).toBe(
      'short99',
    );
    expect(extractVideoId('https://example.com/article')).toBeNull();
  });

  it('parses JSON3 and XML caption tracks and extracts manual English track first', () => {
    const jsonSegments = parseJson3Captions({
      events: [
        { tStartMs: 5000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        { tStartMs: 25000, segs: [{ utf8: 'Second segment' }] },
      ],
    });
    expect(jsonSegments).toEqual([
      { startSeconds: 5, timestamp: '00:05', text: 'Hello world' },
      { startSeconds: 25, timestamp: '00:25', text: 'Second segment' },
    ]);

    const xmlSegments = parseXmlCaptions(
      '<transcript><text start="65.2" dur="3.1">Hybrid &amp; local AI&#39;s power</text></transcript>',
    );
    expect(xmlSegments).toEqual([
      {
        startSeconds: 65,
        timestamp: '01:05',
        text: "Hybrid & local AI's power",
      },
    ]);

    const html =
      'var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://example.com/asr","languageCode":"en","kind":"asr"},{"baseUrl":"https://example.com/manual?v=1\\u0026lang=en","languageCode":"en"}]}}};';
    expect(extractCaptionTrackUrlFromHtml(html)).toBe(
      'https://example.com/manual?v=1&lang=en',
    );
  });

  it('parses modern DOM transcript rows and strips duplicate timestamp prefix', () => {
    expect(parseTranscriptDomRow('01:25', '01:25 Welcome to Lecture 4')).toEqual({
      startSeconds: 85,
      timestamp: '01:25',
      text: 'Welcome to Lecture 4',
    });
    expect(parseTranscriptDomRow('00:10', '   ')).toBeNull();
  });

  it('wires onDownloadProgress monitor callback into onDeviceParams.createOptions', () => {
    const progressSpy = vi.fn();
    const params = buildNotesModelParams('local-only', progressSpy);
    const monitor = params.onDeviceParams?.createOptions?.monitor;
    expect(monitor).toBeTypeOf('function');

    let capturedHandler: ((e: { loaded: number }) => void) | undefined;
    monitor?.({
      addEventListener: (_eventType, listener) => {
        capturedHandler = listener;
      },
      removeEventListener: vi.fn(),
    });

    capturedHandler?.({ loaded: 0.42 });
    expect(progressSpy).toHaveBeenCalledWith(42);
  });
});

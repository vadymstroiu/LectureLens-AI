import { describe, expect, it, vi } from 'vitest';
import {
  InferenceMode,
  InferenceSource,
  type AI,
  type GenerateContentResult,
  type HybridParams,
} from 'firebase/ai';
import {
  ALL_CHAPTERS_ID,
  analyzeContentWindow,
  buildExplainModelParams,
  buildFlashcardsModelParams,
  buildFullLectureFlashcardsCloudParams,
  buildNotesModelParams,
  buildQuizModelParams,
  chunkTranscriptSegments,
  CLOUD_MODEL_NAME,
  computeExecutionProgress,
  computeTargetCounts,
  explainConceptSimply,
  extractFullLectureStudyNotes,
  extractStudyNotes,
  filterItemsByChunk,
  formatLatency,
  generateFlashcards,
  generateFullLectureFlashcards,
  generatePracticeQuiz,
  HybridAiError,
  MAX_ON_DEVICE_CHAPTERS,
  mergeFlashcards,
  mergeStudyNotes,
  ON_DEVICE_CHAR_LIMIT,
  parseStructuredJson,
  resolveLocalFirstMode,
  sampleFullLectureForWindow,
  summarizeTelemetry,
  triggerOnDeviceDownload,
} from '../hybridAi';
import {
  buildYouTubeTimestampUrl,
  extractCaptionTrackUrlFromHtml,
  extractVideoId,
  formatTimestamp,
  normalizeOptionalTimestamp,
  normalizeTimestampFields,
  parseJson3Captions,
  parseTranscriptDomRow,
  parseXmlCaptions,
} from '../../content/youtubeTranscriptParser';
import {
  buildMarkdownFilename,
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

  it('retries transient cloud 500 high-demand errors automatically before succeeding', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          '[500 ] This model is currently experiencing high demand. Spikes in demand are usually temporary.',
        ),
      )
      .mockResolvedValueOnce(
        createMockResult(
          {
            cards: [
              {
                id: 'c1',
                front: 'Why use hybrid AI?',
                back: 'Local Nano avoids cloud demand spikes.',
                timestamp: '00:15',
                startSeconds: 15,
              },
            ],
          },
          InferenceSource.IN_CLOUD,
        ),
      );

    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    const result = await generateFlashcards('[00:15] Hybrid resilience', 'hybrid', {
      ai: MOCK_AI,
      sleep: sleepSpy,
      modelFactory: () => ({ generateContent }),
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(800);
    expect(result.data.cards).toHaveLength(1);
  });

  it('does not burn retries on 429 rate-limit errors and surfaces parsed cooldown time', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValue(
        new Error(
          '[429 ] Quota exceeded for metric: free_tier_requests. Please retry in 25.49s.',
        ),
      );
    const sleepSpy = vi.fn();

    await expect(
      extractStudyNotes('[00:00] Rate limit test', 'hybrid', {
        ai: MOCK_AI,
        sleep: sleepSpy,
        modelFactory: () => ({ generateContent }),
      }),
    ).rejects.toMatchObject({
      name: 'HybridAiError',
      code: 'RATE_LIMITED',
      message: expect.stringContaining('~26s'),
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('evenly samples ultra-long lectures across start, middle, and end within maxChars', () => {
    const shortText = '[00:00] Short lecture';
    expect(sampleFullLectureForWindow(shortText, 500)).toBe(shortText);

    const longLines = Array.from(
      { length: 200 },
      (_, idx) => `[${formatTimestamp(idx * 30)}] Segment number ${idx} explaining architecture details.`,
    ).join('\n');

    const sampled = sampleFullLectureForWindow(longLines, 1500);
    expect(sampled.length).toBeLessThanOrEqual(1500);
    expect(sampled).toContain('Segment number 0');
    expect(sampled).toContain('Segment number 199');
    expect(sampled).toContain('...');
  });

  it('computes monotonic execution current % and remaining % left', () => {
    expect(computeExecutionProgress(0)).toEqual({
      percent: 0,
      remainingPercent: 100,
    });
    const mid = computeExecutionProgress(4500, 4500);
    expect(mid.percent).toBeGreaterThan(50);
    expect(mid.percent + mid.remainingPercent).toBe(100);

    const longRun = computeExecutionProgress(60000, 4500);
    expect(longRun.percent).toBe(95);
    expect(longRun.remainingPercent).toBe(5);
  });

  it('triggers and monitors Gemini Nano download progress when LanguageModel.create exists', async () => {
    const originalLm = (globalThis as Record<string, unknown>).LanguageModel;
    const destroySpy = vi.fn();
    const progressSpy = vi.fn();

    const availabilitySpy = vi.fn().mockResolvedValue('available');
    const createSpy = vi.fn().mockImplementation(async (opts?: {
      monitor?: (m: {
        addEventListener: (
          t: string,
          cb: (e: { loaded: number }) => void,
        ) => void;
      }) => void;
    }) => {
      opts?.monitor?.({
        addEventListener: (_t, cb) => {
          cb({ loaded: 0.63 });
        },
      });
      return { destroy: destroySpy };
    });

    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: availabilitySpy,
      create: createSpy,
    };

    try {
      const status = await triggerOnDeviceDownload(progressSpy);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        }),
      );
      expect(availabilitySpy).toHaveBeenCalledWith({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      expect(progressSpy).toHaveBeenCalledWith(63);
      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(status).toBe('available');
    } finally {
      (globalThis as Record<string, unknown>).LanguageModel = originalLm;
    }
  });

  it('runs Cloud->On-Device Explain Simply tutor loop with structured JSON and telemetry', async () => {
    let capturedParams: HybridParams | undefined;
    let tick = 500;

    const paramsCheck = buildExplainModelParams('hybrid');
    expect(paramsCheck.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(paramsCheck.inCloudParams?.model).toBe(CLOUD_MODEL_NAME);

    const result = await explainConceptSimply(
      'App Check',
      'Protects Firebase backends from unauthorized requests.',
      'hybrid',
      {
        ai: MOCK_AI,
        now: () => {
          const current = tick;
          tick += 310;
          return current;
        },
        modelFactory: (_ai, params) => {
          capturedParams = params;
          return {
            generateContent: vi.fn().mockResolvedValue(
              createMockResult(
                {
                  analogy: 'Like a venue bouncer checking a stamped wristband.',
                  keyIdea: 'Ensures only your genuine app talks to Firebase.',
                },
                InferenceSource.ON_DEVICE,
              ),
            ),
          };
        },
      },
    );

    expect(capturedParams?.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(result.telemetry.task).toBe('explain');
    expect(result.telemetry.source).toBe('ON_DEVICE');
    expect(result.telemetry.latencyMs).toBe(310);
    expect(result.data.analogy).toContain('wristband');
    expect(result.data.keyIdea).toContain('genuine app');
  });

  it('summarizes local vs cloud telemetry averages and on-device ratio', () => {
    expect(summarizeTelemetry([])).toEqual({
      localCount: 0,
      cloudCount: 0,
      avgLocalMs: 0,
      avgCloudMs: 0,
      onDevicePercent: 0,
    });

    const summary = summarizeTelemetry([
      {
        source: 'ON_DEVICE',
        latencyMs: 300,
        task: 'notes',
        modelLabel: 'Gemini Nano',
        timestamp: 1,
      },
      {
        source: 'ON_DEVICE',
        latencyMs: 500,
        task: 'flashcards',
        modelLabel: 'Gemini Nano',
        timestamp: 2,
      },
      {
        source: 'ON_DEVICE',
        latencyMs: 400,
        task: 'explain',
        modelLabel: 'Gemini Nano',
        timestamp: 3,
      },
      {
        source: 'IN_CLOUD',
        latencyMs: 1600,
        task: 'quiz',
        modelLabel: CLOUD_MODEL_NAME,
        timestamp: 4,
      },
    ]);

    expect(summary).toEqual({
      localCount: 3,
      cloudCount: 1,
      avgLocalMs: 400,
      avgCloudMs: 1600,
      onDevicePercent: 75,
    });
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

describe('Complete Markdown exporter', () => {
  const sampleSession: LectureSession = {
    sourceId: 'yt:abc123',
    content: {
      sourceId: 'yt:abc123',
      sourceType: 'youtube',
      title: 'Hybrid AI Deep Dive',
      url: 'https://www.youtube.com/watch?v=abc123',
      segments: [],
      rawText: 'Transcript',
      capturedAt: 1700000000000,
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
    userNotes: [
      {
        id: 'n1',
        text: 'Review App Check debug token setup before demo.',
        timestamp: '03:00',
        startSeconds: 180,
        createdAt: 1700000001000,
        updatedAt: 1700000001000,
      },
      {
        id: 'n2',
        text: 'Remember to test offline mode.',
        createdAt: 1700000002000,
        updatedAt: 1700000002000,
      },
    ],
    flashcards: {
      cards: [
        {
          id: 'c1',
          front: 'What is "App Check", and why use it?',
          back: 'Protects Firebase backends from abuse across clients.',
          timestamp: '02:30',
          startSeconds: 150,
        },
        {
          id: 'c2',
          front: 'What runs on-device?',
          back: 'Gemini Nano.',
          timestamp: '01:15',
          startSeconds: 75,
        },
      ],
    },
    masteredCardIds: ['c1'],
    quiz: {
      questions: [
        {
          id: 'q1',
          question: 'Which mode prefers local Gemini Nano with cloud fallback?',
          options: [
            'ONLY_IN_CLOUD',
            'PREFER_ON_DEVICE',
            'ONLY_ON_DEVICE',
            'MANUAL',
          ],
          correctIndex: 1,
          explanation: 'PREFER_ON_DEVICE tries Nano first and falls back to Cloud.',
          timestamp: '04:00',
          startSeconds: 240,
        },
      ],
    },
    quizAnswers: { q1: 1 },
    explanations: {
      'def:App Check': {
        analogy: 'Like a bouncer checking a stamped wristband.',
        keyIdea: 'Ensures only genuine apps call your Firebase backend.',
      },
      'quiz:q1': {
        analogy: 'Like trying your local workshop before ordering from a warehouse.',
        keyIdea: 'Local first reduces latency while keeping cloud reliability.',
      },
    },
    telemetryHistory: [
      {
        source: 'ON_DEVICE',
        latencyMs: 320,
        task: 'notes',
        modelLabel: 'Gemini Nano',
        timestamp: 1000,
      },
      {
        source: 'IN_CLOUD',
        latencyMs: 1400,
        task: 'quiz',
        modelLabel: CLOUD_MODEL_NAME,
        timestamp: 2000,
      },
    ],
    updatedAt: 1700000002000,
  };

  it('exports all generated sections, personal notes, quiz, analogies, and clickable YouTube links', () => {
    const md = formatStudyMarkdown(sampleSession);
    expect(md).toContain('# Hybrid AI Deep Dive');
    expect(md).toContain('**Source:** [https://www.youtube.com/watch?v=abc123]');
    expect(md).toContain('**Hybrid AI Telemetry:** 1 local (Gemini Nano), 1 cloud (50% on-device)');
    expect(md).toContain(
      '- [01:15](https://www.youtube.com/watch?v=abc123&t=75s) Use PREFER_ON_DEVICE for low latency.',
    );
    expect(md).toContain(
      '- **App Check** ([02:30](https://www.youtube.com/watch?v=abc123&t=150s)): Verifies genuine client traffic.',
    );
    expect(md).toContain('*Analogy:* Like a bouncer checking a stamped wristband.');
    expect(md).toContain('## Personal Notes');
    expect(md).toContain(
      '- [03:00](https://www.youtube.com/watch?v=abc123&t=180s) Review App Check debug token setup before demo.',
    );
    expect(md).toContain('- Remember to test offline mode.');
    expect(md).toContain('*1 of 2 mastered*');
    expect(md).toContain('1. [x] **Q:** What is "App Check", and why use it?');
    expect(md).toContain('2. [ ] **Q:** What runs on-device?');
    expect(md).toContain('## Practice Quiz');
    expect(md).toContain('*Score: 1 / 1 (1 answered)*');
    expect(md).toContain('### 1. Which mode prefers local Gemini Nano with cloud fallback? ([04:00](https://www.youtube.com/watch?v=abc123&t=240s))');
    expect(md).toContain('- B. PREFER_ON_DEVICE **(Correct)** *(Your answer)*');
    expect(md).toContain('> **Explanation:** PREFER_ON_DEVICE tries Nano first and falls back to Cloud.');
    expect(md).toContain('> **Nano Analogy:** Like trying your local workshop');
  });

  it('keeps genuine non-zero manual timestamps, omits 00:00 on non-YouTube sources, and builds clean .md filenames', () => {
    const manualSession: LectureSession = {
      ...sampleSession,
      sourceId: 'manual:1',
      content: {
        ...sampleSession.content,
        sourceId: 'manual:1',
        sourceType: 'manual',
        title: 'Distributed Systems: Week 3!',
        url: '',
      },
      notes: {
        overview: 'Article overview.',
        takeaways: [
          {
            point: 'Article takeaway without timeline.',
            timestamp: '00:00',
            startSeconds: 0,
          },
          {
            point: 'Use PREFER_ON_DEVICE for low latency.',
            timestamp: '01:15',
            startSeconds: 75,
          },
        ],
        definitions: [],
      },
    };
    const md = formatStudyMarkdown(manualSession);
    expect(md).toContain('- Article takeaway without timeline.');
    expect(md).not.toContain('[00:00]');
    expect(md).toContain('- [01:15] Use PREFER_ON_DEVICE for low latency.');
    expect(md).not.toContain('youtube.com/watch');
    expect(buildMarkdownFilename('Distributed Systems: Week 3!')).toBe(
      'lecturelens-distributed-systems-week-3.md',
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

  it('builds deep-linked YouTube timestamp URLs and validates optional note timestamps', () => {
    expect(
      buildYouTubeTimestampUrl(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s',
        185,
      ),
    ).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=185s');
    expect(buildYouTubeTimestampUrl('https://youtu.be/abc123XYZ', 0)).toBe(
      'https://www.youtube.com/watch?v=abc123XYZ&t=0s',
    );
    expect(
      buildYouTubeTimestampUrl('https://www.youtube.com/shorts/short99', -4),
    ).toBe('https://www.youtube.com/watch?v=short99&t=0s');
    expect(
      buildYouTubeTimestampUrl('https://example.com/article', 90),
    ).toBeNull();

    expect(normalizeOptionalTimestamp('4:15')).toEqual({
      timestamp: '04:15',
      startSeconds: 255,
    });
    expect(normalizeOptionalTimestamp('[1:05:09]')).toEqual({
      timestamp: '1:05:09',
      startSeconds: 3909,
    });
    expect(normalizeOptionalTimestamp('02:75')).toBeNull();
    expect(normalizeOptionalTimestamp('abc')).toBeNull();
    expect(normalizeOptionalTimestamp('   ')).toBeNull();
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

describe('Full-lecture scaling, map-reduce, cancellation & chapter filtering', () => {
  it('scales target counts proportionally from short excerpts to 39m+ lectures', () => {
    const shortCounts = computeTargetCounts(4000);
    expect(shortCounts.quizCount).toBe(5);
    expect(shortCounts.flashcardsMax).toBe(8);

    const medCounts = computeTargetCounts(12000);
    expect(medCounts.quizCount).toBe(8);
    expect(medCounts.flashcardsMax).toBe(14);

    const longCounts = computeTargetCounts(28000);
    expect(longCounts.quizCount).toBe(10);
    expect(longCounts.flashcardsMax).toBe(20);

    const extraLongCounts = computeTargetCounts(42000);
    expect(extraLongCounts.quizCount).toBe(12);
    expect(extraLongCounts.takeawaysMax).toBeGreaterThanOrEqual(18);
    expect(extraLongCounts.flashcardsMax).toBeGreaterThanOrEqual(20);
  });

  it('scales generatePracticeQuiz to 12 questions for a 42,000-char lecture', async () => {
    const longLecture = 'x'.repeat(42000);
    const mockQuestions = Array.from({ length: 14 }, (_, i) => ({
      id: `q-${i + 1}`,
      question: `Question ${i + 1}`,
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      explanation: 'Explanation',
      timestamp: formatTimestamp(i * 180),
      startSeconds: i * 180,
    }));

    const result = await generatePracticeQuiz(longLecture, {
      ai: MOCK_AI,
      modelFactory: () => ({
        generateContent: vi
          .fn()
          .mockResolvedValue(
            createMockResult({ questions: mockQuestions }, InferenceSource.IN_CLOUD),
          ),
      }),
    });

    expect(result.data.questions).toHaveLength(12);
  });

  it('runs on-device chapter map-reduce for extractFullLectureStudyNotes when Nano is available', async () => {
    const segments = Array.from({ length: 90 }, (_, idx) => ({
      startSeconds: idx * 25,
      timestamp: formatTimestamp(idx * 25),
      text: `Concept segment ${idx}: `.padEnd(180, 'a'),
    }));
    const chunks = chunkTranscriptSegments(segments);
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const fullText = segments.map((s) => `[${s.timestamp}] ${s.text}`).join('\n');
    const progressCalls: Array<[number, number, string]> = [];
    let callIdx = 0;

    const generateContent = vi.fn().mockImplementation(async () => {
      const current = callIdx++;
      const chunkStart = chunks[current]?.startSeconds ?? 0;
      return createMockResult(
        {
          overview: `Summary ${current}`,
          takeaways: [
            {
              point: `Takeaway from chapter ${current + 1}`,
              timestamp: formatTimestamp(chunkStart + 5),
              startSeconds: chunkStart + 5,
            },
          ],
          definitions: [
            {
              term: `Term ${current + 1}`,
              definition: `Definition ${current + 1}`,
              timestamp: formatTimestamp(chunkStart + 10),
              startSeconds: chunkStart + 10,
            },
          ],
        },
        InferenceSource.ON_DEVICE,
      );
    });

    const result = await extractFullLectureStudyNotes(chunks, fullText, 'hybrid', {
      ai: MOCK_AI,
      checkAvailability: async () => 'available',
      onChapterProgress: (c, t, label) => progressCalls.push([c, t, label]),
      modelFactory: () => ({ generateContent }),
    });

    expect(generateContent).toHaveBeenCalledTimes(chunks.length);
    expect(progressCalls).toHaveLength(chunks.length);
    expect(result.telemetry.source).toBe('ON_DEVICE');
    expect(result.data.takeaways).toHaveLength(chunks.length);
    expect(result.data.definitions).toHaveLength(chunks.length);
  });

  it('uses a single Cloud call for extractFullLectureStudyNotes when Nano is unavailable in hybrid mode', async () => {
    const segments = Array.from({ length: 80 }, (_, idx) => ({
      startSeconds: idx * 30,
      timestamp: formatTimestamp(idx * 30),
      text: `Cloud fallback segment ${idx} `.padEnd(160, 'b'),
    }));
    const chunks = chunkTranscriptSegments(segments);
    const fullText = segments.map((s) => `[${s.timestamp}] ${s.text}`).join('\n');

    let capturedMode: InferenceMode | undefined;
    const generateContent = vi.fn().mockResolvedValue(
      createMockResult(
        {
          overview: 'Full lecture cloud summary.',
          takeaways: [
            { point: 'Start takeaway', timestamp: '00:30', startSeconds: 30 },
            { point: 'End takeaway', timestamp: '39:00', startSeconds: 2340 },
          ],
          definitions: [
            {
              term: 'Hybrid Cloud Fallback',
              definition: 'Single-call full-lecture synthesis.',
              timestamp: '10:00',
              startSeconds: 600,
            },
          ],
        },
        InferenceSource.IN_CLOUD,
      ),
    );

    const result = await extractFullLectureStudyNotes(chunks, fullText, 'hybrid', {
      ai: MOCK_AI,
      checkAvailability: async () => 'unavailable',
      modelFactory: (_ai, params) => {
        capturedMode = params.mode;
        return { generateContent };
      },
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(capturedMode).toBe(InferenceMode.ONLY_IN_CLOUD);
    expect(result.telemetry.source).toBe('IN_CLOUD');
    expect(result.data.takeaways).toHaveLength(2);
  });

  it('supports full-lecture flashcards map-reduce, cloud fallback, and AbortSignal cancellation', async () => {
    const segments = Array.from({ length: 70 }, (_, idx) => ({
      startSeconds: idx * 25,
      timestamp: formatTimestamp(idx * 25),
      text: `Flashcard segment ${idx} `.padEnd(170, 'c'),
    }));
    const chunks = chunkTranscriptSegments(segments);
    const fullText = segments.map((s) => `[${s.timestamp}] ${s.text}`).join('\n');

    // Cloud fallback single call
    const cloudGenerate = vi.fn().mockResolvedValue(
      createMockResult(
        {
          cards: [
            {
              id: 'c1',
              front: 'Q1',
              back: 'A1',
              timestamp: '01:00',
              startSeconds: 60,
            },
          ],
        },
        InferenceSource.IN_CLOUD,
      ),
    );

    const cloudResult = await generateFullLectureFlashcards(
      chunks,
      fullText,
      'hybrid',
      {
        ai: MOCK_AI,
        checkAvailability: async () => 'unavailable',
        modelFactory: () => ({ generateContent: cloudGenerate }),
      },
    );
    expect(cloudGenerate).toHaveBeenCalledTimes(1);
    expect(cloudResult.data.cards).toHaveLength(1);

    // AbortSignal cancellation
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateFullLectureFlashcards(chunks, fullText, 'local-only', {
        ai: MOCK_AI,
        signal: controller.signal,
        modelFactory: () => ({ generateContent: vi.fn() }),
      }),
    ).rejects.toMatchObject({
      name: 'HybridAiError',
      code: 'ABORTED',
    });
  });

  it('filters items by chapter bounds without dropping gap timestamps and merges without duplicates', () => {
    const chunks = [
      {
        id: 'chunk-1',
        label: 'Part 1 (00:00–04:50)',
        startTimestamp: '00:00',
        endTimestamp: '04:50',
        startSeconds: 0,
        endSeconds: 290,
        charCount: 100,
        text: '',
        segments: [],
      },
      {
        id: 'chunk-2',
        label: 'Part 2 (05:10–10:00)',
        startTimestamp: '05:10',
        endTimestamp: '10:00',
        startSeconds: 310,
        endSeconds: 600,
        charCount: 100,
        text: '',
        segments: [],
      },
    ];

    const items = [
      { id: 'a', startSeconds: 120 },
      { id: 'gap', startSeconds: 295 },
      { id: 'b', startSeconds: 400 },
    ];

    expect(filterItemsByChunk(items, chunks, ALL_CHAPTERS_ID)).toHaveLength(3);
    expect(filterItemsByChunk(items, chunks, 'chunk-1').map((i) => i.id)).toEqual([
      'a',
      'gap',
    ]);
    expect(filterItemsByChunk(items, chunks, 'chunk-2').map((i) => i.id)).toEqual([
      'b',
    ]);

    const mergedNotes = mergeStudyNotes(
      {
        overview: 'First overview',
        takeaways: [{ point: 'Point A', timestamp: '02:00', startSeconds: 120 }],
        definitions: [
          {
            term: 'Nano',
            definition: 'Local model',
            timestamp: '00:30',
            startSeconds: 30,
          },
        ],
      },
      {
        overview: 'Second overview',
        takeaways: [
          { point: 'point a', timestamp: '02:00', startSeconds: 120 },
          { point: 'Point B', timestamp: '00:45', startSeconds: 45 },
        ],
        definitions: [
          {
            term: 'nano',
            definition: 'Duplicate term',
            timestamp: '00:30',
            startSeconds: 30,
          },
        ],
      },
    );

    expect(mergedNotes.overview).toBe('First overview');
    expect(mergedNotes.takeaways.map((t) => t.point)).toEqual([
      'Point B',
      'Point A',
    ]);
    expect(mergedNotes.definitions).toHaveLength(1);

    const mergedCards = mergeFlashcards(
      {
        cards: [
          {
            id: 'c1',
            front: 'What is Nano?',
            back: 'Local model',
            timestamp: '03:00',
            startSeconds: 180,
          },
        ],
      },
      {
        cards: [
          {
            id: 'c1',
            front: 'what is nano?',
            back: 'Dup',
            timestamp: '03:00',
            startSeconds: 180,
          },
          {
            id: 'c1',
            front: 'What is Flash?',
            back: 'Cloud model',
            timestamp: '01:00',
            startSeconds: 60,
          },
        ],
      },
    );

    expect(mergedCards.cards.map((c) => c.front)).toEqual([
      'What is Flash?',
      'What is Nano?',
    ]);
    expect(new Set(mergedCards.cards.map((c) => c.id)).size).toBe(2);
  });

  it('covers up to 12 on-device chapters and enforces minItems/maxItems on flashcard and quiz schemas', async () => {
    expect(MAX_ON_DEVICE_CHAPTERS).toBe(12);

    const cardsParams = buildFlashcardsModelParams('hybrid', undefined, [3, 4]);
    const cloudCardsSchema = cardsParams.inCloudParams?.generationConfig
      ?.responseSchema as unknown as {
      properties?: { cards?: { minItems?: number; maxItems?: number } };
    };
    const nanoCardsConstraint = cardsParams.onDeviceParams?.promptOptions
      ?.responseConstraint as {
      properties?: { cards?: { minItems?: number; maxItems?: number } };
    };
    expect(cloudCardsSchema?.properties?.cards?.minItems).toBe(3);
    expect(cloudCardsSchema?.properties?.cards?.maxItems).toBe(4);
    expect(nanoCardsConstraint?.properties?.cards?.minItems).toBe(3);
    expect(nanoCardsConstraint?.properties?.cards?.maxItems).toBe(4);

    const fullCloudCardsParams = buildFullLectureFlashcardsCloudParams([18, 24]);
    const fullCardsSchema = fullCloudCardsParams.inCloudParams?.generationConfig
      ?.responseSchema as unknown as {
      properties?: { cards?: { minItems?: number; maxItems?: number } };
    };
    expect(fullCardsSchema?.properties?.cards?.minItems).toBe(18);
    expect(fullCardsSchema?.properties?.cards?.maxItems).toBe(24);

    const quiz12Params = buildQuizModelParams(12);
    const quiz12Schema = quiz12Params.inCloudParams?.generationConfig
      ?.responseSchema as unknown as {
      properties?: {
        questions?: {
          minItems?: number;
          maxItems?: number;
          items?: {
            properties?: {
              options?: { minItems?: number; maxItems?: number };
            };
          };
        };
      };
    };
    expect(quiz12Schema?.properties?.questions?.minItems).toBe(12);
    expect(quiz12Schema?.properties?.questions?.maxItems).toBe(12);
    expect(
      quiz12Schema?.properties?.questions?.items?.properties?.options?.minItems,
    ).toBe(4);
    expect(
      quiz12Schema?.properties?.questions?.items?.properties?.options?.maxItems,
    ).toBe(4);

    // 9-chapter lecture runs all 9 chunks without skipping any chapter
    const nineChunks = Array.from({ length: 9 }, (_, i) => ({
      id: `chunk-${i + 1}`,
      label: `Part ${i + 1}`,
      startTimestamp: formatTimestamp(i * 300),
      endTimestamp: formatTimestamp((i + 1) * 300),
      startSeconds: i * 300,
      endSeconds: (i + 1) * 300,
      charCount: 5500,
      text: `[${formatTimestamp(i * 300)}] Chapter ${i + 1} detailed content `.padEnd(5500, 'd'),
      segments: [],
    }));
    const fullText9 = nineChunks.map((c) => c.text).join('\n');

    let cardCallIdx = 0;
    const generateContent = vi.fn().mockImplementation(async () => {
      const idx = cardCallIdx++;
      const ts = nineChunks[idx]?.startSeconds ?? 0;
      return createMockResult(
        {
          cards: [
            {
              id: 'c1',
              front: `Question ${idx + 1}A`,
              back: 'Answer A',
              timestamp: formatTimestamp(ts),
              startSeconds: ts,
            },
            {
              id: 'c2',
              front: `Question ${idx + 1}B`,
              back: 'Answer B',
              timestamp: formatTimestamp(ts + 10),
              startSeconds: ts + 10,
            },
            {
              id: 'c3',
              front: `Question ${idx + 1}C`,
              back: 'Answer C',
              timestamp: formatTimestamp(ts + 20),
              startSeconds: ts + 20,
            },
          ],
        },
        InferenceSource.ON_DEVICE,
      );
    });

    const cardsRes = await generateFullLectureFlashcards(
      nineChunks,
      fullText9,
      'hybrid',
      {
        ai: MOCK_AI,
        checkAvailability: async () => 'available',
        modelFactory: () => ({ generateContent }),
      },
    );

    expect(generateContent).toHaveBeenCalledTimes(9);
    expect(cardsRes.data.cards).toHaveLength(27);
  });

  it('strips square brackets from timestamps, repairs wrong model startSeconds, and sorts chronologically', async () => {
    expect(
      normalizeTimestampFields({ timestamp: '[12:36]', startSeconds: 12 }),
    ).toEqual({
      timestamp: '12:36',
      startSeconds: 756,
    });

    const notesRes = await extractStudyNotes('[05:33] Lecture text', 'hybrid', {
      ai: MOCK_AI,
      modelFactory: () => ({
        generateContent: vi.fn().mockResolvedValue(
          createMockResult(
            {
              overview: 'Summary',
              takeaways: [
                {
                  point: 'Second takeaway',
                  timestamp: '[12:36]',
                  startSeconds: 12,
                },
                {
                  point: 'First takeaway',
                  timestamp: '05:33',
                  startSeconds: 333,
                },
              ],
              definitions: [],
            },
            InferenceSource.ON_DEVICE,
          ),
        ),
      }),
    });

    expect(notesRes.data.takeaways).toEqual([
      { point: 'First takeaway', timestamp: '05:33', startSeconds: 333 },
      { point: 'Second takeaway', timestamp: '12:36', startSeconds: 756 },
    ]);
  });
});

export interface TranscriptSegment {
  startSeconds: number;
  timestamp: string;
  text: string;
}

export interface TranscriptChunk {
  id: string;
  label: string;
  startTimestamp: string;
  endTimestamp: string;
  startSeconds: number;
  endSeconds: number;
  charCount: number;
  text: string;
  segments: TranscriptSegment[];
}

/**
 * Supported origin types for captured study content.
 * Note: `'sample'` is retained only for backwards-compatible deserialization of previously stored local sessions.
 */
export type ContentSourceType = 'youtube' | 'article' | 'manual' | 'sample';

export interface CapturedContent {
  sourceId: string;
  sourceType: ContentSourceType;
  title: string;
  url: string;
  segments: TranscriptSegment[];
  rawText: string;
  capturedAt: number;
}

export interface StudyNote {
  point: string;
  timestamp: string;
  startSeconds: number;
}

export interface KeyDefinition {
  term: string;
  definition: string;
  timestamp: string;
  startSeconds: number;
}

export interface StudyNotesData {
  overview: string;
  takeaways: StudyNote[];
  definitions: KeyDefinition[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  timestamp: string;
  startSeconds: number;
}

export interface FlashcardsData {
  cards: Flashcard[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  timestamp: string;
  startSeconds: number;
}

export interface QuizData {
  questions: QuizQuestion[];
}

/**
 * User-authored study note optionally anchored to a lecture timestamp.
 */
export interface UserNote {
  id: string;
  text: string;
  timestamp?: string;
  startSeconds?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SimpleExplanation {
  analogy: string;
  keyIdea: string;
}

export type InferenceSourceValue = 'ON_DEVICE' | 'IN_CLOUD';

export type HybridRoutingPolicy = 'hybrid' | 'local-only';

export type OnDeviceAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export type StudyTaskKind = 'notes' | 'flashcards' | 'quiz' | 'explain';

/**
 * Active stage inside the automatic capture-to-study-kit pipeline.
 */
export type PipelineStage = 'notes' | 'flashcards' | 'quiz';

/**
 * Live progress metadata for multi-stage and multi-chapter AI execution.
 */
export interface PipelineProgress {
  stage: PipelineStage;
  stageIndex: number;
  totalStages: number;
  chapterIndex?: number;
  totalChapters?: number;
  chapterLabel?: string;
}

export interface InferenceTelemetry {
  source: InferenceSourceValue;
  latencyMs: number;
  task: StudyTaskKind;
  modelLabel: string;
  timestamp: number;
}

export interface LectureSession {
  sourceId: string;
  content: CapturedContent;
  notes?: StudyNotesData;
  flashcards?: FlashcardsData;
  masteredCardIds: string[];
  quiz?: QuizData;
  quizAnswers: Record<string, number>;
  userNotes?: UserNote[];
  explanations?: Record<string, SimpleExplanation>;
  lastTelemetry?: InferenceTelemetry;
  telemetryHistory: InferenceTelemetry[];
  updatedAt: number;
}

export interface CaptureTranscriptRequest {
  type: 'CAPTURE_TRANSCRIPT';
}

export type CaptureTranscriptResponse =
  | {
      ok: true;
      videoId: string;
      title: string;
      url: string;
      segments: TranscriptSegment[];
    }
  | {
      ok: false;
      error: string;
    };

export interface SeekVideoRequest {
  type: 'SEEK_VIDEO';
  startSeconds: number;
}

export type SeekVideoResponse =
  | {
      ok: true;
      currentTime: number;
    }
  | {
      ok: false;
      error: string;
    };

export interface GetVideoTimeRequest {
  type: 'GET_VIDEO_TIME';
}

export type GetVideoTimeResponse =
  | {
      ok: true;
      currentSeconds: number;
      timestamp: string;
    }
  | {
      ok: false;
      error: string;
    };

export interface PauseVideoRequest {
  type: 'PAUSE_VIDEO';
}

export interface PauseVideoResponse {
  ok: boolean;
}

export type ExtensionMessage =
  | CaptureTranscriptRequest
  | SeekVideoRequest
  | GetVideoTimeRequest
  | PauseVideoRequest;

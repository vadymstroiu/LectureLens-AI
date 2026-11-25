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
  charCount: number;
  text: string;
  segments: TranscriptSegment[];
}

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

export type InferenceSourceValue = 'ON_DEVICE' | 'IN_CLOUD';

export type HybridRoutingPolicy = 'hybrid' | 'local-only';

export type OnDeviceAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export type StudyTaskKind = 'notes' | 'flashcards' | 'quiz';

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

export type ExtensionMessage = CaptureTranscriptRequest | SeekVideoRequest;

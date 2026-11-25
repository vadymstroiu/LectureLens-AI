import type { CapturedContent } from '../types/lecture';
import { formatSegmentsAsTranscript } from '../content/youtubeTranscriptParser';

const SAMPLE_SEGMENTS = [
  {
    startSeconds: 0,
    timestamp: '00:00',
    text: 'Welcome to Lecture 4 on Hybrid AI Architectures for the Browser. Today we examine why combining on-device inference with cloud Gemini models transforms latency, privacy, and cost.',
  },
  {
    startSeconds: 38,
    timestamp: '00:38',
    text: 'First, let us define On-Device Inference: executing a quantized small language model such as Gemini Nano directly inside Chrome without sending raw user data over the network.',
  },
  {
    startSeconds: 95,
    timestamp: '01:35',
    text: 'On-device inference shines for low-latency, bounded-context tasks under roughly 6,000 characters, such as summarizing a lecture chapter, extracting definitions, or creating flashcards offline.',
  },
  {
    startSeconds: 158,
    timestamp: '02:38',
    text: 'However, small local models have a tighter context window. When analyzing an hour-long lecture transcript, cloud synthesis with Gemini 3.8 Flash provides deep cross-chapter reasoning.',
  },
  {
    startSeconds: 224,
    timestamp: '03:44',
    text: 'This is where Firebase AI Logic Hybrid Inference comes in. Using PREFER_ON_DEVICE mode with explicit inCloudParams gives automatic cloud fallback whenever Gemini Nano is unavailable.',
  },
  {
    startSeconds: 290,
    timestamp: '04:50',
    text: 'For strict privacy workflows, switching to ONLY_ON_DEVICE guarantees zero network egress, while ONLY_IN_CLOUD handles complex multi-document synthesis and full-lecture assessments.',
  },
];

export const SAMPLE_LECTURE_CONTENT: CapturedContent = {
  sourceId: 'sample-hybrid-ai-lecture',
  sourceType: 'sample',
  title: 'CS 329: Hybrid On-Device & Cloud AI Architectures',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  segments: SAMPLE_SEGMENTS,
  rawText: formatSegmentsAsTranscript(SAMPLE_SEGMENTS),
  capturedAt: Date.now(),
};

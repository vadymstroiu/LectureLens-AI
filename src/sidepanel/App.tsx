import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Download,
  FileText,
  HardDrive,
  HelpCircle,
  Layers,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Youtube,
  Zap,
} from 'lucide-react';
import {
  formatSegmentsAsTranscript,
  mergeCaptionSegments,
  parseTranscriptDomRow,
} from '../content/youtubeTranscriptParser';
import { isFirebaseConfigured } from '../lib/firebase';
import {
  analyzeContentWindow,
  checkOnDeviceAvailability,
  chunkTranscriptSegments,
  computeExecutionProgress,
  extractStudyNotes,
  formatLatency,
  generateFlashcards,
  generatePracticeQuiz,
  HybridAiError,
  triggerOnDeviceDownload,
} from '../lib/hybridAi';
import type {
  CapturedContent,
  CaptureTranscriptResponse,
  HybridRoutingPolicy,
  InferenceTelemetry,
  LectureSession,
  OnDeviceAvailability,
  SeekVideoResponse,
} from '../types/lecture';
import { FlashcardsTab } from './FlashcardsTab';
import { InferenceBadge } from './InferenceBadge';
import { NotesTab } from './NotesTab';
import { QuizTab } from './QuizTab';
import { SAMPLE_LECTURE_CONTENT } from './sampleLecture';
import {
  downloadTextFile,
  formatAnkiCsv,
  formatStudyMarkdown,
} from './exporters';
import {
  loadLastActiveSession,
  loadPreferences,
  loadSession,
  savePreferences,
  saveSession,
} from './storage';

type ActiveTab = 'notes' | 'flashcards' | 'quiz';

function createEmptySession(content: CapturedContent): LectureSession {
  return {
    sourceId: content.sourceId,
    content,
    masteredCardIds: [],
    quizAnswers: {},
    telemetryHistory: [],
    updatedAt: Date.now(),
  };
}

function hashText(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return `text-${Math.abs(hash)}`;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [policy, setPolicy] = useState<HybridRoutingPolicy>('local-only');
  const [onDeviceStatus, setOnDeviceStatus] =
    useState<OnDeviceAvailability>('unavailable');
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');

  const [session, setSession] = useState<LectureSession | null>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<string>('chunk-1');
  const [pasteDrawerOpen, setPasteDrawerOpen] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');

  const [capturing, setCapturing] = useState(false);
  const [loadingTask, setLoadingTask] = useState<ActiveTab | null>(null);
  const [downloadingNano, setDownloadingNano] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorState, setErrorState] = useState<{
    message: string;
    hint?: string;
    code?: string;
  } | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [dismissedSetupBanner, setDismissedSetupBanner] = useState(false);

  const firebaseReady = isFirebaseConfigured();

  // Initialize theme, routing preferences, Gemini Nano readiness, and last offline session
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [prefs, lastSession, nanoStatus] = await Promise.all([
        loadPreferences(),
        loadLastActiveSession(),
        checkOnDeviceAvailability(),
      ]);
      if (!mounted) return;
      setTheme(prefs.theme);
      setPolicy(prefs.policy);
      setOnDeviceStatus(nanoStatus);
      if (lastSession) {
        setSession(lastSession);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Sync Tailwind dark class on root html element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Poll Gemini Nano readiness while downloading
  useEffect(() => {
    if (
      onDeviceStatus !== 'downloading' &&
      onDeviceStatus !== 'downloadable'
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void checkOnDeviceAvailability().then((next) => {
        setOnDeviceStatus(next);
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [onDeviceStatus]);

  // Track elapsed execution / download time for live % progress indicator
  useEffect(() => {
    if (!loadingTask && !downloadingNano) {
      setElapsedMs(0);
      return;
    }

    const startedAt = performance.now();
    setElapsedMs(100);
    const timer = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAt);
    }, 100);

    return () => window.clearInterval(timer);
  }, [loadingTask, downloadingNano]);

  const handleDownloadNano = async () => {
    setErrorState(null);
    setDownloadingNano(true);
    setDownloadProgress(0);
    setOnDeviceStatus('downloading');
    try {
      const nextStatus = await triggerOnDeviceDownload((pct) => {
        setDownloadProgress(pct);
      });
      setOnDeviceStatus(nextStatus);
      if (nextStatus === 'available') {
        setStatusBanner('Gemini Nano is downloaded and ready for Local-Only AI!');
      }
    } catch (error) {
      setErrorState({
        message: 'Could not start Gemini Nano download monitor.',
        hint: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDownloadingNano(false);
      setDownloadProgress(null);
    }
  };

  const persistSession = useCallback((nextSession: LectureSession) => {
    setSession(nextSession);
    void saveSession(nextSession);
  }, []);

  const updatePolicy = (nextPolicy: HybridRoutingPolicy) => {
    setPolicy(nextPolicy);
    setErrorState(null);
    void savePreferences({ policy: nextPolicy, theme });
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    void savePreferences({ policy, theme: nextTheme });
  };

  const chunks = useMemo(() => {
    if (!session?.content.segments.length) return [];
    return chunkTranscriptSegments(session.content.segments);
  }, [session?.content.segments]);

  useEffect(() => {
    if (chunks.length > 0 && !chunks.some((c) => c.id === selectedChunkId)) {
      setSelectedChunkId(chunks[0].id);
    }
  }, [chunks, selectedChunkId]);

  const activeChunk = useMemo(
    () => chunks.find((c) => c.id === selectedChunkId) ?? chunks[0],
    [chunks, selectedChunkId],
  );

  const fullText = session?.content.rawText ?? '';
  const windowAnalysis = useMemo(
    () => analyzeContentWindow(fullText),
    [fullText],
  );

  // For Notes & Flashcards, use the selected <=6,000 char chunk when segmented
  const localWindowText = activeChunk ? activeChunk.text : fullText;

  const activateContent = async (content: CapturedContent) => {
    const existing = await loadSession(content.sourceId);
    if (existing) {
      const refreshed: LectureSession = {
        ...existing,
        content,
        updatedAt: Date.now(),
      };
      persistSession(refreshed);
      setStatusBanner('Restored saved study session from offline storage.');
      return;
    }

    persistSession(createEmptySession(content));
    setStatusBanner(null);
  };

  const handleCaptureYouTube = async () => {
    setErrorState(null);
    setStatusBanner(null);
    setCapturing(true);

    try {
      const tab = await getActiveTab();
      if (!tab?.id) {
        setErrorState({
          message: 'No active browser tab detected.',
          hint: 'Focus a YouTube video tab or paste study text below.',
        });
        return;
      }

      const sendCapture = async (tabId: number) =>
        (await chrome.tabs.sendMessage(tabId, {
          type: 'CAPTURE_TRANSCRIPT',
        })) as CaptureTranscriptResponse;

      let response: CaptureTranscriptResponse;
      try {
        response = await sendCapture(tab.id);
      } catch {
        // Fallback for tabs open before extension reload: run self-contained DOM extractor
        if (!tab.url?.includes('youtube.com')) {
          throw new Error(
            'Navigate to a youtube.com/watch?v=... tab or use Paste / Selected Text below.',
          );
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async () => {
            const url = window.location.href;
            const parsedUrl = new URL(url);
            const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
            const videoId =
              parsedUrl.searchParams.get('v') ||
              (['shorts', 'live', 'embed'].includes(pathParts[0])
                ? pathParts[1]
                : '');
            if (!videoId) {
              return {
                ok: false as const,
                error:
                  'Open a YouTube video watch page (youtube.com/watch?v=...) to capture a transcript.',
              };
            }

            const title =
              document
                .querySelector<HTMLElement>(
                  'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string',
                )
                ?.textContent?.trim() ||
              document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() ||
              'YouTube Lecture';

            const readDomRows = () => {
              const rows: Array<{ timestampText: string; bodyText: string }> = [];
              document
                .querySelectorAll('transcript-segment-view-model')
                .forEach((node) => {
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
                  if (bodyText.trim()) {
                    rows.push({ timestampText, bodyText });
                  }
                });

              if (rows.length > 0) return rows;

              document
                .querySelectorAll('ytd-transcript-segment-renderer')
                .forEach((node) => {
                  const timestampText =
                    node.querySelector('.segment-timestamp')?.textContent?.trim() ??
                    '';
                  const bodyText =
                    node.querySelector('.segment-text')?.textContent ?? '';
                  if (bodyText.trim()) {
                    rows.push({ timestampText, bodyText });
                  }
                });

              return rows;
            };

            let rows = readDomRows();
            if (rows.length === 0) {
              const findTranscriptBtn = () =>
                document.querySelector<HTMLElement>(
                  'ytd-video-description-transcript-section-renderer button, button[aria-label*="transcript" i]',
                ) ??
                Array.from(document.querySelectorAll<HTMLElement>('button')).find(
                  (btn) =>
                    /show\s+transcript/i.test(btn.textContent ?? '') ||
                    /transcript/i.test(btn.getAttribute('aria-label') ?? ''),
                ) ??
                null;

              let transcriptBtn = findTranscriptBtn();
              if (!transcriptBtn) {
                const expandBtn = document.querySelector<HTMLElement>(
                  'tp-yt-paper-button#expand, #description-inline-expander #expand, #expand',
                );
                if (expandBtn) {
                  expandBtn.click();
                  await new Promise((r) => setTimeout(r, 300));
                  transcriptBtn = findTranscriptBtn();
                }
              }

              if (transcriptBtn) {
                transcriptBtn.click();
                const deadline = Date.now() + 4500;
                while (Date.now() < deadline) {
                  await new Promise((r) => setTimeout(r, 150));
                  rows = readDomRows();
                  if (rows.length > 0) break;
                }
              }
            }

            return {
              ok: true as const,
              videoId,
              title,
              url,
              rows,
            };
          },
        });

        const payload = results[0]?.result;
        if (!payload || !payload.ok) {
          response = {
            ok: false,
            error:
              payload?.error ||
              'Could not extract transcript from this YouTube tab.',
          };
        } else {
          const parsedRows = payload.rows
            .map((r) => parseTranscriptDomRow(r.timestampText, r.bodyText))
            .filter((seg): seg is NonNullable<typeof seg> => seg !== null);
          const segments = mergeCaptionSegments(parsedRows);
          response =
            segments.length > 0
              ? {
                  ok: true,
                  videoId: payload.videoId,
                  title: payload.title,
                  url: payload.url,
                  segments,
                }
              : {
                  ok: false,
                  error:
                    'No transcript segments were found. Scroll down on YouTube, click "Show transcript", and try again—or paste text below.',
                };
        }
      }

      if (!response.ok) {
        setErrorState({
          message: response.error,
          hint: 'You can also paste transcript or article text using the drawer below.',
        });
        return;
      }

      const rawText = formatSegmentsAsTranscript(response.segments);
      await activateContent({
        sourceId: `yt:${response.videoId}`,
        sourceType: 'youtube',
        title: response.title,
        url: response.url,
        segments: response.segments,
        rawText,
        capturedAt: Date.now(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorState({
        message: 'Could not capture YouTube transcript from this tab.',
        hint: msg,
      });
    } finally {
      setCapturing(false);
    }
  };

  const handleGrabSelection = async () => {
    setErrorState(null);
    try {
      const tab = await getActiveTab();
      if (!tab?.id) {
        setErrorState({ message: 'No active tab to read selection from.' });
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString()?.trim() ?? '',
      });

      const selected = (results[0]?.result as string | undefined) ?? '';
      if (!selected) {
        setErrorState({
          message: 'No highlighted text found on the active page.',
          hint: 'Highlight an article paragraph on the page first, or paste text directly.',
        });
        return;
      }

      setPastedText(selected);
      if (!pastedTitle && tab.title) {
        setPastedTitle(tab.title);
      }
      setPasteDrawerOpen(true);

      await activateContent({
        sourceId: `article:${hashText(selected)}`,
        sourceType: 'article',
        title: tab.title || 'Selected Web Excerpt',
        url: tab.url || '',
        segments: [],
        rawText: selected,
        capturedAt: Date.now(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorState({
        message: 'Unable to read selection from this page.',
        hint: msg,
      });
    }
  };

  const handleApplyPastedText = async () => {
    const cleaned = pastedText.trim();
    if (!cleaned) return;
    setErrorState(null);

    await activateContent({
      sourceId: `manual:${hashText(cleaned)}`,
      sourceType: 'manual',
      title: pastedTitle.trim() || 'Pasted Study Material',
      url: '',
      segments: [],
      rawText: cleaned,
      capturedAt: Date.now(),
    });
    setPasteDrawerOpen(false);
  };

  const handleLoadSample = async () => {
    setErrorState(null);
    await activateContent({
      ...SAMPLE_LECTURE_CONTENT,
      capturedAt: Date.now(),
    });
    setStatusBanner('Loaded sample Hybrid AI lecture — ready to test!');
  };

  const handleSeekVideo = async (startSeconds: number) => {
    try {
      const tab = await getActiveTab();
      if (!tab?.id) return;

      try {
        const res = (await chrome.tabs.sendMessage(tab.id, {
          type: 'SEEK_VIDEO',
          startSeconds,
        })) as SeekVideoResponse;

        if (!res.ok) {
          setStatusBanner(res.error);
        }
        return;
      } catch {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (sec: number) => {
            const video = document.querySelector<HTMLVideoElement>('video');
            if (!video) return false;
            video.currentTime = Math.max(0, sec);
            void video.play().catch(() => undefined);
            return true;
          },
          args: [startSeconds],
        });

        if (!results[0]?.result) {
          setStatusBanner('No active YouTube video player found on this tab.');
        }
      }
    } catch {
      setStatusBanner(
        'Open the matching YouTube tab to seek video playback directly.',
      );
    }
  };

  const recordTelemetry = (
    current: LectureSession,
    telemetry: InferenceTelemetry,
  ): Pick<LectureSession, 'lastTelemetry' | 'telemetryHistory'> => ({
    lastTelemetry: telemetry,
    telemetryHistory: [telemetry, ...current.telemetryHistory].slice(0, 12),
  });

  const handleAiError = (error: unknown) => {
    if (error instanceof HybridAiError) {
      setErrorState({
        code: error.code,
        message: error.message,
        hint: error.recoveryHint,
      });
      return;
    }
    setErrorState({
      message: error instanceof Error ? error.message : 'Unexpected AI error.',
    });
  };

  const handleGenerateNotes = async () => {
    if (!session) return;
    setErrorState(null);
    setDownloadProgress(null);
    setLoadingTask('notes');
    try {
      const { data, telemetry } = await extractStudyNotes(
        localWindowText,
        policy,
        {
          onDownloadProgress: (pct) => {
            setDownloadProgress(pct);
            setOnDeviceStatus('downloading');
          },
        },
      );
      if (telemetry.source === 'ON_DEVICE') {
        setOnDeviceStatus('available');
      }
      persistSession({
        ...session,
        notes: data,
        ...recordTelemetry(session, telemetry),
        updatedAt: Date.now(),
      });
    } catch (error) {
      handleAiError(error);
    } finally {
      setLoadingTask(null);
      setDownloadProgress(null);
    }
  };

  const handleGenerateFlashcards = async () => {
    if (!session) return;
    setErrorState(null);
    setDownloadProgress(null);
    setLoadingTask('flashcards');
    try {
      const { data, telemetry } = await generateFlashcards(
        localWindowText,
        policy,
        {
          onDownloadProgress: (pct) => {
            setDownloadProgress(pct);
            setOnDeviceStatus('downloading');
          },
        },
      );
      if (telemetry.source === 'ON_DEVICE') {
        setOnDeviceStatus('available');
      }
      persistSession({
        ...session,
        flashcards: data,
        masteredCardIds: [],
        ...recordTelemetry(session, telemetry),
        updatedAt: Date.now(),
      });
    } catch (error) {
      handleAiError(error);
    } finally {
      setLoadingTask(null);
      setDownloadProgress(null);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!session) return;
    setErrorState(null);
    setLoadingTask('quiz');
    try {
      const { data, telemetry } = await generatePracticeQuiz(fullText);
      persistSession({
        ...session,
        quiz: data,
        quizAnswers: {},
        ...recordTelemetry(session, telemetry),
        updatedAt: Date.now(),
      });
    } catch (error) {
      handleAiError(error);
    } finally {
      setLoadingTask(null);
    }
  };

  const handleToggleMastered = (cardId: string) => {
    if (!session) return;
    const exists = session.masteredCardIds.includes(cardId);
    const masteredCardIds = exists
      ? session.masteredCardIds.filter((id) => id !== cardId)
      : [...session.masteredCardIds, cardId];
    persistSession({
      ...session,
      masteredCardIds,
      updatedAt: Date.now(),
    });
  };

  const handleSelectQuizAnswer = (questionId: string, optionIndex: number) => {
    if (!session) return;
    persistSession({
      ...session,
      quizAnswers: {
        ...session.quizAnswers,
        [questionId]: optionIndex,
      },
      updatedAt: Date.now(),
    });
  };

  const handleResetQuiz = () => {
    if (!session) return;
    persistSession({
      ...session,
      quizAnswers: {},
      updatedAt: Date.now(),
    });
  };

  const handleCopyMarkdown = async () => {
    if (!session) return;
    const md = formatStudyMarkdown(session);
    await navigator.clipboard.writeText(md);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 1800);
  };

  const handleExportAnkiCsv = () => {
    if (!session?.flashcards?.cards.length) return;
    const csv = formatAnkiCsv(session.flashcards.cards);
    const slug = (session.content.title || 'lecture')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    downloadTextFile(`lecturelens-${slug || 'cards'}.csv`, csv);
  };

  const canExportMarkdown = Boolean(
    session && (session.notes || session.flashcards?.cards.length),
  );
  const canExportCsv = Boolean(session?.flashcards?.cards.length);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Header Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-3.5 py-2.5 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-xs">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">LectureLens AI</h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Hybrid vs Local-Only Toggle Pill */}
            <div
              className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-0.5 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-900"
              role="group"
              aria-label="Hybrid routing policy"
            >
              <button
                type="button"
                onClick={() => updatePolicy('hybrid')}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition ${
                  policy === 'hybrid'
                    ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-800 dark:text-indigo-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title="Prefer Gemini Nano on-device with automatic Cloud Gemini 3.8 Flash fallback"
              >
                <Zap className="h-2.5 w-2.5" />
                Hybrid
              </button>
              <button
                type="button"
                onClick={() => updatePolicy('local-only')}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition ${
                  policy === 'local-only'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title="Strict Local-Only (Offline Privacy) — ONLY_ON_DEVICE"
              >
                <ShieldCheck className="h-2.5 w-2.5" />
                Local-Only
              </button>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Toggle light/dark theme"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Live Telemetry & Inference Source Row */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <InferenceBadge
            telemetry={session?.lastTelemetry}
            history={session?.telemetryHistory ?? []}
            onDeviceStatus={onDeviceStatus}
            policy={policy}
            downloadProgress={downloadProgress}
          />
          {session && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
              <HardDrive className="h-2.5 w-2.5" />
              Saved offline
            </span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 space-y-3.5 p-3.5">
        {!firebaseReady && !dismissedSetupBanner && (
          <div className="flex items-start justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-200">
            <div>
              <span className="font-semibold">Firebase config pending:</span> Copy{' '}
              <code className="font-mono">.env.example</code> to{' '}
              <code className="font-mono">.env</code> and rebuild for Cloud Gemini 3.8
              Flash fallback &amp; Quiz synthesis.
            </div>
            <button
              type="button"
              onClick={() => setDismissedSetupBanner(true)}
              className="shrink-0 font-semibold underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Content Capture Card */}
        <section className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={capturing}
              onClick={handleCaptureYouTube}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-500 disabled:opacity-50"
            >
              <Youtube className="h-4 w-4" />
              <span>
                {capturing ? 'Capturing...' : 'Capture YouTube Transcript'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleLoadSample}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Load a built-in sample lecture for instant testing"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              Sample
            </button>
          </div>

          {/* Collapsible Paste / Selected Text Drawer */}
          <div>
            <button
              type="button"
              onClick={() => setPasteDrawerOpen((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Paste / Selected Text
              </span>
              {pasteDrawerOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {pasteDrawerOpen && (
              <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                <input
                  type="text"
                  value={pastedTitle}
                  onChange={(e) => setPastedTitle(e.target.value)}
                  placeholder="Optional title (e.g., Distributed Systems Notes)"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                />
                <textarea
                  rows={4}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste lecture transcript, documentation, or article text..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleGrabSelection}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Grab Page Selection
                  </button>
                  <button
                    type="button"
                    disabled={!pastedText.trim()}
                    onClick={handleApplyPastedText}
                    className="flex-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                  >
                    Use Pasted Text
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Captured Content Summary & Window Indicator */}
          {session ? (
            <div className="space-y-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                  {session.content.title}
                </p>
                <span className="shrink-0 rounded-md bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {windowAnalysis.charCount.toLocaleString()} chars
                </span>
              </div>

              <p
                className={`text-[11px] font-medium ${
                  windowAnalysis.fitsOnDevice
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-sky-600 dark:text-sky-400'
                }`}
              >
                {windowAnalysis.hint}
              </p>

              {chunks.length > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 pt-2 dark:border-slate-700">
                  <label
                    htmlFor="chapter-chunk-select"
                    className="text-[11px] font-medium text-slate-600 dark:text-slate-300"
                  >
                    Nano Chapter:
                  </label>
                  <select
                    id="chapter-chunk-select"
                    value={activeChunk?.id ?? ''}
                    onChange={(e) => setSelectedChunkId(e.target.value)}
                    className="max-w-[205px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {chunks.map((chunk) => (
                      <option key={chunk.id} value={chunk.id}>
                        {chunk.label} • {chunk.charCount}ch
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-[11px] text-slate-500 dark:text-slate-400">
              Open a YouTube lecture or click <strong>Sample</strong> to explore hybrid
              on-device + cloud studying.
            </p>
          )}
        </section>

        {/* Live Execution / Download Progress Card */}
        {(loadingTask !== null || downloadingNano) && (() => {
          const isNanoDl = downloadProgress !== null;
          const execProgress = computeExecutionProgress(
            elapsedMs,
            loadingTask === 'quiz' ? 6500 : 4000,
          );
          const currentPct = isNanoDl ? downloadProgress : execProgress.percent;
          const leftPct = 100 - currentPct;
          const taskTitle = isNanoDl
            ? 'Downloading Gemini Nano'
            : loadingTask === 'notes'
              ? 'Extracting Study Notes'
              : loadingTask === 'flashcards'
                ? 'Creating Flashcards'
                : 'Generating Cloud Quiz';

          return (
            <div className="space-y-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs">
              <div className="flex items-center justify-between gap-2 font-semibold text-indigo-800 dark:text-indigo-200">
                <span>{taskTitle}</span>
                <span className="font-mono text-[11px]">
                  {currentPct}% • {leftPct}% left
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200/70 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-150"
                  style={{ width: `${currentPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-indigo-700/80 dark:text-indigo-300/80">
                <span>
                  {isNanoDl
                    ? 'One-time Chrome on-device model download'
                    : policy === 'local-only' && loadingTask !== 'quiz'
                      ? 'Running on-device (Local-Only)'
                      : 'Running via Firebase AI Logic'}
                </span>
                <span className="font-mono">{formatLatency(elapsedMs)} elapsed</span>
              </div>
            </div>
          );
        })()}

        {/* Status or Error Alerts */}
        {(onDeviceStatus === 'downloadable' ||
          (onDeviceStatus === 'downloading' && !downloadingNano)) && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-200">
            <p className="font-semibold">
              {onDeviceStatus === 'downloading'
                ? 'Chrome is downloading Gemini Nano in the background'
                : 'Gemini Nano is ready to download (~1.7 GB)'}
              {typeof downloadProgress === 'number'
                ? ` (${downloadProgress}% • ${100 - downloadProgress}% left)`
                : ''}
            </p>
            <p className="leading-relaxed opacity-90">
              {policy === 'local-only'
                ? 'Local-Only mode is active (default). Track live download % below, or switch to Hybrid for Cloud fallback anytime.'
                : 'Hybrid mode will automatically use Cloud fallback until Nano finishes downloading.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {!loadingTask && (
                <button
                  type="button"
                  onClick={handleDownloadNano}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-500"
                >
                  <Download className="h-3 w-3" />
                  Track / Download Gemini Nano
                </button>
              )}
              {policy === 'local-only' && (
                <button
                  type="button"
                  onClick={() => updatePolicy('hybrid')}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                >
                  <Zap className="h-3 w-3" />
                  Switch to Hybrid
                </button>
              )}
            </div>
          </div>
        )}

        {statusBanner && (
          <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-700 dark:text-indigo-200">
            {statusBanner}
          </div>
        )}

        {errorState && (
          <div className="space-y-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <div className="space-y-1">
                <p className="font-semibold">{errorState.message}</p>
                {errorState.hint && (
                  <p className="text-[11px] leading-relaxed opacity-90">
                    {errorState.hint}
                  </p>
                )}
              </div>
            </div>
            {errorState.code === 'ON_DEVICE_UNAVAILABLE' && (
              <button
                type="button"
                onClick={() => updatePolicy('hybrid')}
                className="mt-1 inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
              >
                Switch to Hybrid (Auto Cloud Fallback)
              </button>
            )}
          </div>
        )}

        {/* Tabs Navigation */}
        <nav
          className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900"
          aria-label="Study workspace tabs"
        >
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'notes'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Notes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('flashcards')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'flashcards'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Flashcards
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quiz')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'quiz'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Quiz
          </button>
        </nav>

        {/* Active Tab View */}
        {activeTab === 'notes' && (
          <NotesTab
            notes={session?.notes}
            hasContent={Boolean(session)}
            isLoading={loadingTask === 'notes'}
            policy={policy}
            onGenerate={handleGenerateNotes}
            onSeekVideo={handleSeekVideo}
          />
        )}

        {activeTab === 'flashcards' && (
          <FlashcardsTab
            flashcards={session?.flashcards}
            masteredCardIds={session?.masteredCardIds ?? []}
            hasContent={Boolean(session)}
            isLoading={loadingTask === 'flashcards'}
            policy={policy}
            onGenerate={handleGenerateFlashcards}
            onToggleMastered={handleToggleMastered}
            onSeekVideo={handleSeekVideo}
          />
        )}

        {activeTab === 'quiz' && (
          <QuizTab
            quiz={session?.quiz}
            answers={session?.quizAnswers ?? {}}
            hasContent={Boolean(session)}
            isLoading={loadingTask === 'quiz'}
            policy={policy}
            onGenerate={handleGenerateQuiz}
            onSelectAnswer={handleSelectQuizAnswer}
            onResetQuiz={handleResetQuiz}
            onSeekVideo={handleSeekVideo}
          />
        )}
      </main>

      {/* Bottom Export Action Bar */}
      <footer className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 px-3.5 py-2.5 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canExportMarkdown}
            onClick={handleCopyMarkdown}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {copiedFeedback ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <ClipboardCopy className="h-3.5 w-3.5" />
                <span>Copy Markdown</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!canExportCsv}
            onClick={handleExportAnkiCsv}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Anki CSV</span>
          </button>
        </div>
      </footer>
    </div>
  );
}

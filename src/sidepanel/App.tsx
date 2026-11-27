import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { BookOpen, HelpCircle, Layers } from 'lucide-react';
import { formatSegmentsAsTranscript } from '../content/youtubeTranscriptParser';
import { isFirebaseConfigured } from '../lib/firebase';
import {
  ALL_CHAPTERS_ID,
  analyzeContentWindow,
  checkOnDeviceAvailability,
  chunkTranscriptSegments,
  explainConceptSimply,
  extractFullLectureStudyNotes,
  extractStudyNotes,
  filterItemsByChunk,
  generateFlashcards,
  generateFullLectureFlashcards,
  generatePracticeQuiz,
  HybridAiError,
  mergeFlashcards,
  mergeStudyNotes,
  triggerOnDeviceDownload,
} from '../lib/hybridAi';
import type {
  CapturedContent,
  HybridRoutingPolicy,
  InferenceTelemetry,
  LectureSession,
  OnDeviceAvailability,
  PipelineProgress,
  PipelineStage,
  UserNote,
} from '../types/lecture';
import { CaptureCard } from './components/CaptureCard';
import { ExportBar } from './components/ExportBar';
import { HeaderBar } from './components/HeaderBar';
import { HelpModal } from './components/HelpModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { OnboardingEmptyState } from './components/OnboardingEmptyState';
import { StatusAlerts, type ErrorBannerState } from './components/StatusAlerts';
import {
  buildMarkdownFilename,
  downloadTextFile,
  formatStudyMarkdown,
} from './exporters';
import { FlashcardsTab } from './FlashcardsTab';
import { NotesTab } from './NotesTab';
import { QuizTab } from './QuizTab';
import {
  deleteSession,
  getStorageUsageSummary,
  listSavedSessions,
  loadLastActiveSession,
  loadPreferences,
  loadSession,
  savePreferences,
  saveSession,
  type StorageUsageSummary,
} from './storage';
import {
  captureYouTubeFromActiveTab,
  getCurrentYouTubeVideoTime,
  grabSelectionFromActiveTab,
  isYouTubeUrl,
  openChromePage,
  openSourceUrl,
  seekOrOpenVideo,
} from './youtubeBridge';

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

/**
 * Root Chrome Side Panel orchestrator for LectureLens AI.
 */
export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [policy, setPolicy] = useState<HybridRoutingPolicy>('hybrid');
  const [autoGenerateOnCapture, setAutoGenerateOnCapture] = useState(true);
  const [onDeviceStatus, setOnDeviceStatus] =
    useState<OnDeviceAvailability>('unavailable');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');

  const [session, setSession] = useState<LectureSession | null>(null);
  const [savedSessions, setSavedSessions] = useState<LectureSession[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsageSummary | null>(
    null,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedChunkId, setSelectedChunkId] = useState<string>(ALL_CHAPTERS_ID);
  const [pasteDrawerOpen, setPasteDrawerOpen] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');

  const [capturing, setCapturing] = useState(false);
  const [loadingTask, setLoadingTask] = useState<ActiveTab | null>(null);
  const [pipelineProgress, setPipelineProgress] =
    useState<PipelineProgress | null>(null);
  const [explainingKey, setExplainingKey] = useState<string | null>(null);
  const [downloadingNano, setDownloadingNano] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorState, setErrorState] = useState<ErrorBannerState | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [dismissedSetupBanner, setDismissedSetupBanner] = useState(false);
  const nanoPrewarmAttemptedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const onDeviceStatusRef = useRef<OnDeviceAvailability>(onDeviceStatus);
  onDeviceStatusRef.current = onDeviceStatus;
  const tabRefs = useRef<Record<ActiveTab, HTMLButtonElement | null>>({
    notes: null,
    flashcards: null,
    quiz: null,
  });

  const firebaseReady = isFirebaseConfigured();

  // Initialize theme, routing preferences, Gemini Nano readiness, and offline library
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [prefs, lastSession, allSessions, usage, nanoStatus] =
        await Promise.all([
          loadPreferences(),
          loadLastActiveSession(),
          listSavedSessions(),
          getStorageUsageSummary(),
          checkOnDeviceAvailability(),
        ]);
      if (!mounted) return;
      setTheme(prefs.theme);
      setPolicy(prefs.policy);
      setAutoGenerateOnCapture(prefs.autoGenerateOnCapture);
      setOnDeviceStatus(nanoStatus);
      setSavedSessions(allSessions);
      setStorageUsage(usage);
      if (lastSession) {
        setSession(lastSession);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Track online/offline network status in real time
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;

    setErrorState(null);
    setDownloadingNano(true);
    setDownloadProgress(0);
    setOnDeviceStatus('downloading');
    try {
      const nextStatus = await triggerOnDeviceDownload((pct) => {
        setDownloadProgress(pct);
      }, controller.signal);
      setOnDeviceStatus(nextStatus);
      if (nextStatus === 'available') {
        setStatusBanner('Gemini Nano is downloaded and ready for Local-Only AI!');
      }
    } catch (error) {
      if (error instanceof HybridAiError && error.code === 'ABORTED') {
        setStatusBanner(
          'Stopped tracking Gemini Nano download. Chrome may finish it in the background while Hybrid mode uses Cloud fallback.',
        );
      } else {
        setErrorState({
          message: 'Could not start Gemini Nano download monitor.',
          hint: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (downloadAbortRef.current === controller) {
        downloadAbortRef.current = null;
      }
      setDownloadingNano(false);
      setDownloadProgress(null);
    }
  };

  const handleCancelDownload = () => {
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = null;
    setDownloadingNano(false);
    setDownloadProgress(null);
    void checkOnDeviceAvailability().then(setOnDeviceStatus);
    setStatusBanner(
      'Stopped tracking Gemini Nano download. Chrome may finish it in the background while Hybrid mode uses Cloud fallback.',
    );
  };

  const handleOpenChromePage = async (url: string) => {
    const opened = await openChromePage(url);
    if (!opened) {
      setStatusBanner(`Copied ${url} — paste it into Chrome's address bar.`);
    }
  };

  const handleOpenSourceUrl = async (url: string) => {
    const res = await openSourceUrl(url);
    if (!res.ok) {
      await handleOpenChromePage(url);
      return;
    }
    if (res.action === 'already-active') {
      setStatusBanner('Already viewing this lecture in the active tab.');
    } else if (res.action === 'focused-existing-tab') {
      setStatusBanner('Switched to your open lecture tab.');
    }
  };

  const handleRecheckOrDownloadNano = async () => {
    const status = await checkOnDeviceAvailability();
    setOnDeviceStatus(status);
    if (status === 'available') {
      setErrorState(null);
      setStatusBanner('Gemini Nano is ready! You can run Local-Only now.');
      return;
    }
    if (status === 'downloadable') {
      setErrorState(null);
      await handleDownloadNano();
      return;
    }
    if (status === 'downloading') {
      setStatusBanner('Gemini Nano is currently downloading in Chrome.');
      return;
    }
    setStatusBanner(
      'Enable both Chrome flags below, click Relaunch in Chrome, then click Check / Download Nano.',
    );
  };

  const handleFirstClickPrewarm = () => {
    if (
      nanoPrewarmAttemptedRef.current ||
      onDeviceStatus !== 'downloadable' ||
      downloadingNano
    ) {
      return;
    }
    nanoPrewarmAttemptedRef.current = true;
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;

    setDownloadingNano(true);
    setDownloadProgress(0);
    setOnDeviceStatus('downloading');

    void triggerOnDeviceDownload((pct) => {
      setDownloadProgress(pct);
    }, controller.signal)
      .then((nextStatus) => {
        setOnDeviceStatus(nextStatus);
        if (nextStatus === 'available') {
          setStatusBanner('Gemini Nano is ready for private on-device AI!');
        }
      })
      .catch(() => {
        // Silent background pre-warm / cancel should never interrupt Hybrid mode
      })
      .finally(() => {
        if (downloadAbortRef.current === controller) {
          downloadAbortRef.current = null;
        }
        setDownloadingNano(false);
        setDownloadProgress(null);
      });
  };

  const handleModelDownloadProgress = useCallback((pct: number) => {
    if (pct >= 100 || onDeviceStatusRef.current === 'available') {
      setDownloadProgress(null);
      return;
    }
    setDownloadProgress(pct);
    setOnDeviceStatus('downloading');
  }, []);

  const persistSession = useCallback((nextSession: LectureSession) => {
    setSession(nextSession);
    void saveSession(nextSession).then(async () => {
      const [all, usage] = await Promise.all([
        listSavedSessions(),
        getStorageUsageSummary(),
      ]);
      setSavedSessions(all);
      setStorageUsage(usage);
    });
  }, []);

  const handleSelectSavedSession = (target: LectureSession) => {
    setSession(target);
    setSelectedChunkId(ALL_CHAPTERS_ID);
    setLibraryOpen(false);
    setErrorState(null);
    setStatusBanner(`Loaded "${target.content.title}" from local study history.`);
    void saveSession(target);
  };

  const handleDeleteSavedSession = async (sourceId: string) => {
    await deleteSession(sourceId);
    const [remaining, usage] = await Promise.all([
      listSavedSessions(),
      getStorageUsageSummary(),
    ]);
    setSavedSessions(remaining);
    setStorageUsage(usage);
    if (session?.sourceId === sourceId) {
      setSession(remaining[0] ?? null);
      setSelectedChunkId(ALL_CHAPTERS_ID);
      setStatusBanner(null);
      setErrorState(null);
    }
  };

  const updatePolicy = (nextPolicy: HybridRoutingPolicy) => {
    setPolicy(nextPolicy);
    setErrorState(null);
    void savePreferences({
      policy: nextPolicy,
      theme,
      autoGenerateOnCapture,
    });
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    void savePreferences({
      policy,
      theme: nextTheme,
      autoGenerateOnCapture,
    });
  };

  const toggleAutoGenerate = (enabled: boolean) => {
    setAutoGenerateOnCapture(enabled);
    void savePreferences({
      policy,
      theme,
      autoGenerateOnCapture: enabled,
    });
  };

  const chunks = useMemo(() => {
    if (!session?.content.segments.length) return [];
    return chunkTranscriptSegments(session.content.segments);
  }, [session?.content.segments]);

  useEffect(() => {
    if (
      selectedChunkId !== ALL_CHAPTERS_ID &&
      chunks.length > 0 &&
      !chunks.some((c) => c.id === selectedChunkId)
    ) {
      setSelectedChunkId(ALL_CHAPTERS_ID);
    }
  }, [chunks, selectedChunkId]);

  const activeChunk = useMemo(
    () =>
      selectedChunkId === ALL_CHAPTERS_ID
        ? undefined
        : chunks.find((c) => c.id === selectedChunkId),
    [chunks, selectedChunkId],
  );

  const fullText = session?.content.rawText ?? '';
  const windowAnalysis = useMemo(
    () => analyzeContentWindow(fullText),
    [fullText],
  );

  const filteredNotes = useMemo(() => {
    if (!session?.notes) return undefined;
    if (!activeChunk) return session.notes;
    return {
      ...session.notes,
      takeaways: filterItemsByChunk(
        session.notes.takeaways,
        chunks,
        selectedChunkId,
      ),
      definitions: filterItemsByChunk(
        session.notes.definitions,
        chunks,
        selectedChunkId,
      ),
    };
  }, [activeChunk, chunks, selectedChunkId, session?.notes]);

  const filteredFlashcards = useMemo(() => {
    if (!session?.flashcards) return undefined;
    if (!activeChunk) return session.flashcards;
    return {
      cards: filterItemsByChunk(
        session.flashcards.cards,
        chunks,
        selectedChunkId,
      ),
    };
  }, [activeChunk, chunks, selectedChunkId, session?.flashcards]);

  const filteredQuiz = useMemo(() => {
    if (!session?.quiz) return undefined;
    if (!activeChunk) return session.quiz;
    return {
      questions: filterItemsByChunk(
        session.quiz.questions,
        chunks,
        selectedChunkId,
      ),
    };
  }, [activeChunk, chunks, selectedChunkId, session?.quiz]);

  const handleCancelGeneration = () => {
    abortControllerRef.current?.abort();
  };

  const runAutoStudyPipeline = async (initialSession: LectureSession) => {
    const stages: PipelineStage[] = [];
    if (!initialSession.notes) stages.push('notes');
    if (!initialSession.flashcards?.cards.length) stages.push('flashcards');
    if (
      !initialSession.quiz?.questions.length &&
      policy === 'hybrid' &&
      isOnline
    ) {
      stages.push('quiz');
    }

    if (stages.length === 0) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let latestSession = initialSession;
    const sessionChunks = chunkTranscriptSegments(
      latestSession.content.segments,
    );

    setErrorState(null);
    setStatusBanner(null);

    try {
      for (let i = 0; i < stages.length; i++) {
        if (controller.signal.aborted) {
          throw new HybridAiError('ABORTED', 'Generation was cancelled.');
        }

        const stage = stages[i];
        setLoadingTask(stage);
        setDownloadProgress(null);
        setPipelineProgress({
          stage,
          stageIndex: i + 1,
          totalStages: stages.length,
        });

        if (stage === 'notes') {
          const { data, telemetry } = await extractFullLectureStudyNotes(
            sessionChunks,
            latestSession.content.rawText,
            policy,
            {
              signal: controller.signal,
              onDownloadProgress: handleModelDownloadProgress,
              onChapterProgress: (chapterIndex, totalChapters, chapterLabel) =>
                setPipelineProgress({
                  stage: 'notes',
                  stageIndex: i + 1,
                  totalStages: stages.length,
                  chapterIndex,
                  totalChapters,
                  chapterLabel,
                }),
            },
          );
          if (telemetry.source === 'ON_DEVICE') {
            setOnDeviceStatus('available');
          }
          latestSession = {
            ...latestSession,
            notes: data,
            ...recordTelemetry(latestSession, telemetry),
            updatedAt: Date.now(),
          };
          persistSession(latestSession);
        } else if (stage === 'flashcards') {
          const { data, telemetry } = await generateFullLectureFlashcards(
            sessionChunks,
            latestSession.content.rawText,
            policy,
            {
              signal: controller.signal,
              onDownloadProgress: handleModelDownloadProgress,
              onChapterProgress: (chapterIndex, totalChapters, chapterLabel) =>
                setPipelineProgress({
                  stage: 'flashcards',
                  stageIndex: i + 1,
                  totalStages: stages.length,
                  chapterIndex,
                  totalChapters,
                  chapterLabel,
                }),
            },
          );
          if (telemetry.source === 'ON_DEVICE') {
            setOnDeviceStatus('available');
          }
          latestSession = {
            ...latestSession,
            flashcards: data,
            masteredCardIds: [],
            ...recordTelemetry(latestSession, telemetry),
            updatedAt: Date.now(),
          };
          persistSession(latestSession);
        } else if (stage === 'quiz') {
          const { data, telemetry } = await generatePracticeQuiz(
            latestSession.content.rawText,
            { signal: controller.signal },
          );
          latestSession = {
            ...latestSession,
            quiz: data,
            quizAnswers: {},
            ...recordTelemetry(latestSession, telemetry),
            updatedAt: Date.now(),
          };
          persistSession(latestSession);
        }
      }

      const takeawaysCount = latestSession.notes?.takeaways.length ?? 0;
      const cardsCount = latestSession.flashcards?.cards.length ?? 0;
      const quizNote = latestSession.quiz
        ? `, ${latestSession.quiz.questions.length} quiz questions`
        : policy === 'local-only'
          ? ' (Cloud Quiz skipped in Local-Only mode)'
          : !isOnline
            ? ' (Cloud Quiz skipped offline)'
            : '';

      setStatusBanner(
        `Study kit ready: ${takeawaysCount} takeaways, ${cardsCount} flashcards${quizNote}.`,
      );
    } catch (error) {
      if (error instanceof HybridAiError && error.code === 'ABORTED') {
        setStatusBanner(
          'Generation cancelled — any completed sections were saved.',
        );
      } else {
        handleAiError(error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoadingTask(null);
      setPipelineProgress(null);
      setDownloadProgress(null);
    }
  };

  const activateContent = async (content: CapturedContent) => {
    setSelectedChunkId(ALL_CHAPTERS_ID);
    const existing = await loadSession(content.sourceId);
    if (existing) {
      const refreshed: LectureSession = {
        ...existing,
        content,
        updatedAt: Date.now(),
      };
      persistSession(refreshed);

      const hasNotes = Boolean(refreshed.notes);
      const hasCards = Boolean(refreshed.flashcards?.cards.length);
      const hasQuizOrNotNeeded =
        Boolean(refreshed.quiz?.questions.length) ||
        policy !== 'hybrid' ||
        !isOnline;

      if (hasNotes && hasCards && hasQuizOrNotNeeded) {
        setStatusBanner('Restored saved study session from offline storage.');
        return;
      }

      if (autoGenerateOnCapture) {
        await runAutoStudyPipeline(refreshed);
      } else {
        setStatusBanner('Restored saved study session from offline storage.');
      }
      return;
    }

    const freshSession = createEmptySession(content);
    persistSession(freshSession);
    setStatusBanner(null);

    if (autoGenerateOnCapture) {
      await runAutoStudyPipeline(freshSession);
    }
  };

  const handleCaptureYouTube = async () => {
    abortControllerRef.current?.abort();
    setErrorState(null);
    setStatusBanner(null);
    setCapturing(true);

    let capturedContent: CapturedContent | null = null;
    try {
      const response = await captureYouTubeFromActiveTab();
      if (!response.ok) {
        setErrorState({
          message: response.error,
          hint: 'You can also paste transcript or article text using the drawer below.',
        });
        return;
      }

      const rawText = formatSegmentsAsTranscript(response.segments);
      capturedContent = {
        sourceId: `yt:${response.videoId}`,
        sourceType: 'youtube',
        title: response.title,
        url: response.url,
        segments: response.segments,
        rawText,
        capturedAt: Date.now(),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorState({
        message: 'Could not capture YouTube transcript from this tab.',
        hint: msg,
      });
    } finally {
      setCapturing(false);
    }

    if (capturedContent) {
      await activateContent(capturedContent);
    }
  };

  const handleGrabSelection = async () => {
    setErrorState(null);
    const res = await grabSelectionFromActiveTab();
    if (!res.ok) {
      setErrorState({
        message: res.error,
        hint: res.hint,
      });
      return;
    }

    setPastedText(res.text);
    if (!pastedTitle && res.title) {
      setPastedTitle(res.title);
    }
    setPasteDrawerOpen(true);

    await activateContent({
      sourceId: `article:${hashText(res.text)}`,
      sourceType: 'article',
      title: res.title,
      url: res.url,
      segments: [],
      rawText: res.text,
      capturedAt: Date.now(),
    });
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

  const handleSeekVideo = async (startSeconds: number) => {
    const res = await seekOrOpenVideo(session?.content.url, startSeconds);
    if (!res.ok) {
      setStatusBanner(res.error);
    } else if (res.action === 'opened-new-tab') {
      setStatusBanner('Opened YouTube video at the selected timestamp.');
    }
  };

  const handleCaptureCurrentTime = async (): Promise<{
    timestamp: string;
    startSeconds: number;
  } | null> => {
    const res = await getCurrentYouTubeVideoTime(session?.content.url);
    if (!res.ok) {
      setStatusBanner(res.error);
      return null;
    }
    return {
      timestamp: res.timestamp,
      startSeconds: res.currentSeconds,
    };
  };

  const handleAddUserNote = (
    text: string,
    timestamp?: string,
    startSeconds?: number,
  ) => {
    if (!session) return;
    const now = Date.now();
    const newNote: UserNote = {
      id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      timestamp,
      startSeconds,
      createdAt: now,
      updatedAt: now,
    };
    persistSession({
      ...session,
      userNotes: [...(session.userNotes ?? []), newNote],
      updatedAt: now,
    });
  };

  const handleUpdateUserNote = (
    id: string,
    text: string,
    timestamp?: string,
    startSeconds?: number,
  ) => {
    if (!session) return;
    const now = Date.now();
    const nextNotes = (session.userNotes ?? []).map((note) =>
      note.id === id
        ? { ...note, text, timestamp, startSeconds, updatedAt: now }
        : note,
    );
    persistSession({
      ...session,
      userNotes: nextNotes,
      updatedAt: now,
    });
  };

  const handleDeleteUserNote = (id: string) => {
    if (!session) return;
    const nextNotes = (session.userNotes ?? []).filter((note) => note.id !== id);
    persistSession({
      ...session,
      userNotes: nextNotes,
      updatedAt: Date.now(),
    });
  };

  const recordTelemetry = (
    current: LectureSession,
    telemetry: InferenceTelemetry,
  ): Pick<LectureSession, 'lastTelemetry' | 'telemetryHistory'> => ({
    lastTelemetry: telemetry,
    telemetryHistory: [telemetry, ...current.telemetryHistory].slice(0, 50),
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
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorState(null);
    setDownloadProgress(null);
    setLoadingTask('notes');
    setPipelineProgress(null);
    try {
      const { data, telemetry } = await extractFullLectureStudyNotes(
        chunks,
        fullText,
        policy,
        {
          signal: controller.signal,
          onDownloadProgress: handleModelDownloadProgress,
          onChapterProgress: (chapterIndex, totalChapters, chapterLabel) =>
            setPipelineProgress({
              stage: 'notes',
              stageIndex: 1,
              totalStages: 1,
              chapterIndex,
              totalChapters,
              chapterLabel,
            }),
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
      if (error instanceof HybridAiError && error.code === 'ABORTED') {
        setStatusBanner('Notes generation cancelled.');
      } else {
        handleAiError(error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoadingTask(null);
      setPipelineProgress(null);
      setDownloadProgress(null);
    }
  };

  const handleDeepDiveChapterNotes = async () => {
    if (!session || !activeChunk) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorState(null);
    setDownloadProgress(null);
    setLoadingTask('notes');
    setPipelineProgress({
      stage: 'notes',
      stageIndex: 1,
      totalStages: 1,
      chapterIndex: 1,
      totalChapters: 1,
      chapterLabel: activeChunk.label,
    });
    try {
      const { data, telemetry } = await extractStudyNotes(
        activeChunk.text,
        policy,
        {
          signal: controller.signal,
          targetTakeaways: [5, 7],
          targetDefinitions: [3, 5],
          onDownloadProgress: handleModelDownloadProgress,
        },
      );
      if (telemetry.source === 'ON_DEVICE') {
        setOnDeviceStatus('available');
      }
      persistSession({
        ...session,
        notes: mergeStudyNotes(session.notes, data),
        ...recordTelemetry(session, telemetry),
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof HybridAiError && error.code === 'ABORTED') {
        setStatusBanner('Chapter deep-dive cancelled.');
      } else {
        handleAiError(error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoadingTask(null);
      setPipelineProgress(null);
      setDownloadProgress(null);
    }
  };

  const handleGenerateFlashcards = async () => {
    if (!session) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorState(null);
    setDownloadProgress(null);
    setLoadingTask('flashcards');
    setPipelineProgress(null);
    try {
      const { data, telemetry } = await generateFullLectureFlashcards(
        chunks,
        fullText,
        policy,
        {
          signal: controller.signal,
          onDownloadProgress: handleModelDownloadProgress,
          onChapterProgress: (chapterIndex, totalChapters, chapterLabel) =>
            setPipelineProgress({
              stage: 'flashcards',
              stageIndex: 1,
              totalStages: 1,
              chapterIndex,
              totalChapters,
              chapterLabel,
            }),
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
      if (error instanceof HybridAiError && error.code === 'ABORTED') {
        setStatusBanner('Flashcards generation cancelled.');
      } else {
        handleAiError(error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoadingTask(null);
      setPipelineProgress(null);
      setDownloadProgress(null);
    }
  };

  const handleDeepDiveChapterFlashcards = async () => {
    if (!session || !activeChunk) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorState(null);
    setDownloadProgress(null);
    setLoadingTask('flashcards');
    setPipelineProgress({
      stage: 'flashcards',
      stageIndex: 1,
      totalStages: 1,
      chapterIndex: 1,
      totalChapters: 1,
      chapterLabel: activeChunk.label,
    });
    try {
      const { data, telemetry } = await generateFlashcards(
        activeChunk.text,
        policy,
        {
          signal: controller.signal,
          targetFlashcards: [5, 7],
          idPrefix: `${activeChunk.id}-deep-`,
          onDownloadProgress: handleModelDownloadProgress,
        },
      );
      if (telemetry.source === 'ON_DEVICE') {
        setOnDeviceStatus('available');
      }
      persistSession({
        ...session,
        flashcards: mergeFlashcards(session.flashcards, data),
        ...recordTelemetry(session, telemetry),
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof HybridAiError && error.code === 'ABORTED') {
        setStatusBanner('Chapter deep-dive cancelled.');
      } else {
        handleAiError(error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoadingTask(null);
      setPipelineProgress(null);
      setDownloadProgress(null);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!session) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorState(null);
    setLoadingTask('quiz');
    setPipelineProgress(null);
    try {
      const { data, telemetry } = await generatePracticeQuiz(fullText, {
        signal: controller.signal,
      });
      persistSession({
        ...session,
        quiz: data,
        quizAnswers: {},
        ...recordTelemetry(session, telemetry),
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof HybridAiError && error.code === 'ABORTED') {
        setStatusBanner('Quiz generation cancelled.');
      } else {
        handleAiError(error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
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

  const handleResetMastered = () => {
    if (!session) return;
    persistSession({
      ...session,
      masteredCardIds: [],
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

  const handleExplainConcept = async (
    key: string,
    concept: string,
    context: string,
  ) => {
    if (!session) return;
    setErrorState(null);
    setExplainingKey(key);
    try {
      const { data, telemetry } = await explainConceptSimply(
        concept,
        context,
        policy,
      );
      if (telemetry.source === 'ON_DEVICE') {
        setOnDeviceStatus('available');
      }
      persistSession({
        ...session,
        explanations: {
          ...(session.explanations ?? {}),
          [key]: data,
        },
        ...recordTelemetry(session, telemetry),
        updatedAt: Date.now(),
      });
    } catch (error) {
      handleAiError(error);
    } finally {
      setExplainingKey(null);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!session) return;
    const md = formatStudyMarkdown(session);
    await navigator.clipboard.writeText(md);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 1800);
  };

  const handleDownloadMarkdown = () => {
    if (!session) return;
    const md = formatStudyMarkdown(session);
    downloadTextFile(
      buildMarkdownFilename(session.content.title),
      md,
      'text/markdown;charset=utf-8',
    );
  };

  const canExportMarkdown = Boolean(
    session &&
      (session.notes ||
        session.flashcards?.cards.length ||
        session.quiz?.questions.length ||
        session.userNotes?.length),
  );

  const tabOrder: ActiveTab[] = ['notes', 'flashcards', 'quiz'];
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: ActiveTab,
  ) => {
    const currentIdx = tabOrder.indexOf(current);
    let nextIdx: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIdx = (currentIdx + 1) % tabOrder.length;
    } else if (event.key === 'ArrowLeft') {
      nextIdx = (currentIdx - 1 + tabOrder.length) % tabOrder.length;
    } else if (event.key === 'Home') {
      nextIdx = 0;
    } else if (event.key === 'End') {
      nextIdx = tabOrder.length - 1;
    }

    if (nextIdx !== null) {
      event.preventDefault();
      const nextTab = tabOrder[nextIdx];
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    }
  };

  return (
    <div
      onClickCapture={handleFirstClickPrewarm}
      className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-indigo-600 focus:px-3 focus:py-1.5 text-xs font-semibold text-white shadow-lg"
      >
        Skip to main content
      </a>

      <HeaderBar
        policy={policy}
        theme={theme}
        onDeviceStatus={onDeviceStatus}
        isOnline={isOnline}
        session={session}
        savedSessionCount={savedSessions.length}
        libraryOpen={libraryOpen}
        helpOpen={helpOpen}
        onChangePolicy={updatePolicy}
        onToggleTheme={toggleTheme}
        onToggleLibrary={() => setLibraryOpen((prev) => !prev)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {/* Main Content */}
      <main
        id="main-content"
        className="mx-auto w-full max-w-2xl flex-1 space-y-3.5 p-3.5"
      >
        <HistoryDrawer
          open={libraryOpen}
          sessions={savedSessions}
          activeSourceId={session?.sourceId}
          storageUsage={storageUsage}
          onSelectSession={handleSelectSavedSession}
          onDeleteSession={(id) => void handleDeleteSavedSession(id)}
          onOpenUrl={(url) => void handleOpenSourceUrl(url)}
          onClose={() => setLibraryOpen(false)}
        />

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

        <CaptureCard
          session={session}
          capturing={capturing}
          autoGenerateOnCapture={autoGenerateOnCapture}
          windowAnalysis={windowAnalysis}
          chunks={chunks}
          activeChunkId={selectedChunkId}
          pasteDrawerOpen={pasteDrawerOpen}
          pastedTitle={pastedTitle}
          pastedText={pastedText}
          onCaptureYouTube={() => void handleCaptureYouTube()}
          onToggleAutoGenerate={toggleAutoGenerate}
          onTogglePasteDrawer={() => setPasteDrawerOpen((prev) => !prev)}
          onChangePastedTitle={setPastedTitle}
          onChangePastedText={setPastedText}
          onGrabSelection={() => void handleGrabSelection()}
          onApplyPastedText={() => void handleApplyPastedText()}
          onSelectChunk={setSelectedChunkId}
          onOpenSourceUrl={(url) => void handleOpenSourceUrl(url)}
        />

        <StatusAlerts
          loadingTask={loadingTask}
          pipelineProgress={pipelineProgress}
          downloadingNano={downloadingNano}
          downloadProgress={downloadProgress}
          elapsedMs={elapsedMs}
          onDeviceStatus={onDeviceStatus}
          policy={policy}
          statusBanner={statusBanner}
          errorState={errorState}
          onDownloadNano={() => void handleDownloadNano()}
          onSwitchToHybrid={() => updatePolicy('hybrid')}
          onRecheckOrDownloadNano={() => void handleRecheckOrDownloadNano()}
          onOpenChromePage={(url) => void handleOpenChromePage(url)}
          onCancelGeneration={handleCancelGeneration}
          onCancelDownload={handleCancelDownload}
        />

        {session ? (
          (() => {
            const isYouTubeSource =
              session.content.sourceType === 'youtube' ||
              isYouTubeUrl(session.content.url);

            return (
              <>
            {/* Tabs Navigation (WAI-ARIA Tabs Pattern) */}
            <div
              role="tablist"
              aria-label="Study workspace"
              className="mx-auto grid w-full max-w-md grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900"
            >
              <button
                ref={(el) => {
                  tabRefs.current.notes = el;
                }}
                id="tab-notes"
                type="button"
                role="tab"
                aria-selected={activeTab === 'notes'}
                aria-controls="panel-notes"
                tabIndex={activeTab === 'notes' ? 0 : -1}
                onClick={() => setActiveTab('notes')}
                onKeyDown={(e) => handleTabKeyDown(e, 'notes')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
                  activeTab === 'notes'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Notes
              </button>
              <button
                ref={(el) => {
                  tabRefs.current.flashcards = el;
                }}
                id="tab-flashcards"
                type="button"
                role="tab"
                aria-selected={activeTab === 'flashcards'}
                aria-controls="panel-flashcards"
                tabIndex={activeTab === 'flashcards' ? 0 : -1}
                onClick={() => setActiveTab('flashcards')}
                onKeyDown={(e) => handleTabKeyDown(e, 'flashcards')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
                  activeTab === 'flashcards'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                Flashcards
              </button>
              <button
                ref={(el) => {
                  tabRefs.current.quiz = el;
                }}
                id="tab-quiz"
                type="button"
                role="tab"
                aria-selected={activeTab === 'quiz'}
                aria-controls="panel-quiz"
                tabIndex={activeTab === 'quiz' ? 0 : -1}
                onClick={() => setActiveTab('quiz')}
                onKeyDown={(e) => handleTabKeyDown(e, 'quiz')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
                  activeTab === 'quiz'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Quiz
              </button>
            </div>

            {/* Active Tab Panel */}
            <div
              id={`panel-${activeTab}`}
              role="tabpanel"
              aria-labelledby={`tab-${activeTab}`}
              tabIndex={0}
              className="focus:outline-none"
            >
              {activeTab === 'notes' && (
                <NotesTab
                  notes={filteredNotes}
                  userNotes={session.userNotes ?? []}
                  isYouTubeSource={isYouTubeSource}
                  hasContent={Boolean(session)}
                  isLoading={loadingTask === 'notes'}
                  policy={policy}
                  explanations={session.explanations}
                  explainingKey={explainingKey}
                  activeChapterLabel={activeChunk?.label}
                  totalTakeawaysCount={session.notes?.takeaways.length}
                  onGenerate={() => void handleGenerateNotes()}
                  onDeepDiveChapter={
                    activeChunk
                      ? () => void handleDeepDiveChapterNotes()
                      : undefined
                  }
                  onSeekVideo={(sec) => void handleSeekVideo(sec)}
                  onExplainConcept={(k, c, ctx) =>
                    void handleExplainConcept(k, c, ctx)
                  }
                  onAddUserNote={handleAddUserNote}
                  onUpdateUserNote={handleUpdateUserNote}
                  onDeleteUserNote={handleDeleteUserNote}
                  onCaptureCurrentTime={handleCaptureCurrentTime}
                />
              )}

              {activeTab === 'flashcards' && (
                <FlashcardsTab
                  flashcards={filteredFlashcards}
                  masteredCardIds={session.masteredCardIds}
                  isYouTubeSource={isYouTubeSource}
                  hasContent={Boolean(session)}
                  isLoading={loadingTask === 'flashcards'}
                  policy={policy}
                  activeChapterLabel={activeChunk?.label}
                  totalCardsCount={session.flashcards?.cards.length}
                  onGenerate={() => void handleGenerateFlashcards()}
                  onDeepDiveChapter={
                    activeChunk
                      ? () => void handleDeepDiveChapterFlashcards()
                      : undefined
                  }
                  onToggleMastered={handleToggleMastered}
                  onResetMastered={handleResetMastered}
                  onSeekVideo={(sec) => void handleSeekVideo(sec)}
                />
              )}

              {activeTab === 'quiz' && (
                <QuizTab
                  quiz={filteredQuiz}
                  answers={session.quizAnswers}
                  isYouTubeSource={isYouTubeSource}
                  hasContent={Boolean(session)}
                  isLoading={loadingTask === 'quiz'}
                  policy={policy}
                  explanations={session.explanations}
                  explainingKey={explainingKey}
                  activeChapterLabel={activeChunk?.label}
                  totalQuestionsCount={session.quiz?.questions.length}
                  onGenerate={() => void handleGenerateQuiz()}
                  onSelectAnswer={handleSelectQuizAnswer}
                  onResetQuiz={handleResetQuiz}
                  onSeekVideo={(sec) => void handleSeekVideo(sec)}
                  onExplainConcept={(k, c, ctx) =>
                    void handleExplainConcept(k, c, ctx)
                  }
                />
              )}
            </div>
              </>
            );
          })()
        ) : (
          <OnboardingEmptyState onOpenHelp={() => setHelpOpen(true)} />
        )}
      </main>

      <ExportBar
        canExport={canExportMarkdown}
        copiedFeedback={copiedFeedback}
        onCopyMarkdown={() => void handleCopyMarkdown()}
        onDownloadMarkdown={handleDownloadMarkdown}
      />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

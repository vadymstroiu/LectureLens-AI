import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  History,
  Search,
  ShieldCheck,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import type { LectureSession } from '../../types/lecture';
import type { StorageUsageSummary } from '../storage';

const HISTORY_PAGE_SIZE = 10;

/**
 * Props for the searchable local Study History drawer.
 */
export interface HistoryDrawerProps {
  open: boolean;
  sessions: LectureSession[];
  activeSourceId?: string;
  storageUsage: StorageUsageSummary | null;
  onSelectSession: (session: LectureSession) => void;
  onDeleteSession: (sourceId: string) => void;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatSessionDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Saved locally';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return 'Saved locally';
  }
}

/**
 * Displays all locally saved study sessions for the current Chrome user
 * profile, including source URLs, parsed timestamps, artifact counts, and search.
 */
export function HistoryDrawer({
  open,
  sessions,
  activeSourceId,
  storageUsage,
  onSelectSession,
  onDeleteSession,
  onOpenUrl,
  onClose,
}: HistoryDrawerProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const filteredSessions = useMemo(() => {
    const cleaned = query.trim().toLowerCase();
    if (!cleaned) return sessions;
    return sessions.filter(
      (item) =>
        item.content.title.toLowerCase().includes(cleaned) ||
        item.content.url.toLowerCase().includes(cleaned),
    );
  }, [query, sessions]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredSessions.length / HISTORY_PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * HISTORY_PAGE_SIZE;
  const paginatedSessions = filteredSessions.slice(
    startIndex,
    startIndex + HISTORY_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  if (!open) return null;

  const usageLabel =
    storageUsage && storageUsage.bytesInUse !== null
      ? `${formatBytes(storageUsage.bytesInUse)} / ${formatBytes(storageUsage.quotaBytes)}`
      : null;

  return (
    <section
      id="study-history-drawer"
      aria-labelledby="history-drawer-title"
      className="space-y-2.5 rounded-2xl border border-indigo-500/30 bg-white p-3 shadow-sm dark:border-indigo-500/30 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="history-drawer-title"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-indigo-700 uppercase dark:text-indigo-300"
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Study History ({sessions.length})</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close study history"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Local-per-profile Privacy & Storage Quota Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-200">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
          Saved locally in your Chrome profile (private &amp; offline)
        </span>
        {usageLabel && <span className="font-mono opacity-90">{usageLabel}</span>}
      </div>

      {/* Search Filter */}
      {sessions.length >= 2 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved lectures or URLs..."
            aria-label="Search study history"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-2.5 pl-8 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      )}

      {filteredSessions.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
          {sessions.length === 0
            ? 'No saved study sessions yet. Capture a YouTube video or article to build your local history.'
            : 'No saved lectures match your search.'}
        </p>
      ) : (
        <>
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-0.5">
            {paginatedSessions.map((item) => {
            const isActive = item.sourceId === activeSourceId;
            const takeawaysCount = item.notes?.takeaways.length ?? 0;
            const userNotesCount = item.userNotes?.length ?? 0;
            const totalCards = item.flashcards?.cards.length ?? 0;
            const masteredCount = item.masteredCardIds.length;
            const quizQuestions = item.quiz?.questions ?? [];
            const answeredQuizCount = quizQuestions.filter(
              (q) => item.quizAnswers[q.id] !== undefined,
            ).length;
            const correctQuizCount = quizQuestions.filter(
              (q) => item.quizAnswers[q.id] === q.correctIndex,
            ).length;

            const SourceIcon =
              item.content.sourceType === 'youtube'
                ? Youtube
                : item.content.sourceType === 'article'
                  ? Globe
                  : FileText;

            return (
              <li
                key={item.sourceId}
                className={`space-y-1.5 rounded-xl border p-2.5 text-xs ${
                  isActive
                    ? 'border-indigo-500/40 bg-indigo-500/10'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectSession(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <SourceIcon
                        className={`h-3.5 w-3.5 shrink-0 ${
                          item.content.sourceType === 'youtube'
                            ? 'text-rose-500'
                            : 'text-indigo-500'
                        }`}
                        aria-hidden="true"
                      />
                      <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                        {item.content.title}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                      {formatSessionDate(item.updatedAt || item.content.capturedAt)}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteSession(item.sourceId)}
                    className="rounded-lg p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-500 dark:text-slate-400"
                    title="Delete saved session"
                    aria-label={`Delete ${item.content.title} from history`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                {item.content.url && (
                  <button
                    type="button"
                    onClick={() => onOpenUrl(item.content.url)}
                    className="inline-flex max-w-full items-center gap-1 truncate text-[10px] font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                    title={item.content.url}
                  >
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.content.url}</span>
                  </button>
                )}

                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                  <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                    {takeawaysCount > 0 ? `${takeawaysCount} Notes` : 'No AI notes'}
                  </span>
                  {userNotesCount > 0 && (
                    <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-800 dark:text-amber-300">
                      {userNotesCount} My Notes
                    </span>
                  )}
                  {totalCards > 0 && (
                    <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-800 dark:text-emerald-300">
                      {masteredCount}/{totalCards} Cards
                    </span>
                  )}
                  {quizQuestions.length > 0 && (
                    <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-sky-800 dark:text-sky-300">
                      {answeredQuizCount > 0
                        ? `Quiz ${correctQuizCount}/${quizQuestions.length}`
                        : `${quizQuestions.length} Quiz Qs`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          </ul>

          {filteredSessions.length > HISTORY_PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2 text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <span>
                Showing {startIndex + 1}–
                {Math.min(startIndex + HISTORY_PAGE_SIZE, filteredSessions.length)} of{' '}
                {filteredSessions.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous history page"
                  className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                  Prev
                </button>
                <span className="font-mono text-[10px]">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next history page"
                  className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Next
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

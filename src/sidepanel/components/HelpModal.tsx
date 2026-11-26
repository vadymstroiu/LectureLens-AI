import { useEffect, useRef } from 'react';
import {
  BookOpen,
  Cloud,
  Cpu,
  Keyboard,
  ShieldCheck,
  X,
  Youtube,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';

/**
 * Props for the interactive How-to-Use & Problem Statement modal.
 */
export interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Accessible modal explaining the problem LectureLens AI solves, the 3-step
 * workflow, Firebase AI Logic hybrid inference routing, local privacy, and
 * keyboard shortcuts.
 */
export function HelpModal({ open, onClose }: HelpModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <BrandLogo size={24} className="shrink-0 rounded-md" />
            <h2
              id="help-modal-title"
              className="text-sm font-bold text-slate-900 dark:text-slate-100"
            >
              How LectureLens AI Works
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 space-y-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          {/* Problem Solved */}
          <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-indigo-700 uppercase dark:text-indigo-300">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              What Problem It Solves
            </h3>
            <p>
              Long YouTube lectures (30–90+ minutes) and dense technical articles
              are slow to review and easy to forget. Cloud-only study tools add
              latency, hit rate limits, and send private study material to
              external servers. LectureLens AI turns any lecture or article into
              timestamped notes, active-recall flashcards, and practice quizzes
              right beside your tab.
            </p>
          </section>

          {/* 3-Step Workflow */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-400">
              <Youtube className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
              How to Use (3 Steps)
            </h3>
            <ol className="list-inside list-decimal space-y-1.5 text-xs">
              <li>
                Open a YouTube lecture (<code className="font-mono">youtube.com/watch?v=...</code>)
                or any web article.
              </li>
              <li>
                Click <strong>Capture YouTube Transcript</strong>, or expand{' '}
                <strong>Paste / Selected Text</strong> to grab highlighted text
                from the active page.
              </li>
              <li>
                Study <strong>Notes</strong> (click any <code className="font-mono">[mm:ss]</code>{' '}
                timestamp chip to jump directly in the video), drill with{' '}
                <strong>Flashcards</strong>, check mastery with the{' '}
                <strong>Quiz</strong>, and export Markdown.
              </li>
            </ol>
          </section>

          {/* Hybrid AI Architecture */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-400">
              <Cpu className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              Firebase AI Logic Hybrid Inference
            </h3>
            <ul className="space-y-1.5">
              <li className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                  Hybrid (Auto — PREFER_ON_DEVICE):
                </span>{' '}
                Runs Notes, Flashcards, and <em>Explain Simply</em> locally on
                Chrome&apos;s <strong>Gemini Nano</strong> when ready, and
                seamlessly falls back to <strong>Cloud Gemini 3.8 Flash</strong>{' '}
                if Nano is still downloading or unavailable.
              </li>
              <li className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Local-Only (ONLY_ON_DEVICE):
                </span>{' '}
                Strict offline privacy with zero cloud calls for Notes,
                Flashcards, and analogies.
              </li>
              <li className="flex items-start gap-1.5 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />
                <span>
                  <strong className="text-sky-700 dark:text-sky-300">
                    Cloud Quiz (ONLY_IN_CLOUD):
                  </strong>{' '}
                  Reasons across full-length transcripts for cross-chapter
                  practice questions.
                </span>
              </li>
            </ul>
          </section>

          {/* Privacy & Shortcuts */}
          <section className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
              <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                Local Storage &amp; Privacy
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Saved sessions stay <strong>100% local</strong> inside your
                Chrome user profile (<code className="font-mono">chrome.storage.local</code>)
                and remain accessible offline.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
              <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                <Keyboard className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                Keyboard Shortcuts
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                <kbd className="rounded border px-1 font-mono text-[10px]">Space</kbd> flip ·{' '}
                <kbd className="rounded border px-1 font-mono text-[10px]">←</kbd>/
                <kbd className="rounded border px-1 font-mono text-[10px]">→</kbd> nav ·{' '}
                <kbd className="rounded border px-1 font-mono text-[10px]">M</kbd> master ·{' '}
                <kbd className="rounded border px-1 font-mono text-[10px]">Esc</kbd> close
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

import { BookOpen, Cloud, Cpu, HelpCircle, ShieldCheck } from 'lucide-react';

/**
 * Props for the first-run onboarding guide card.
 */
export interface OnboardingEmptyStateProps {
  onOpenHelp: () => void;
}

/**
 * Welcoming guide displayed when no lecture session is loaded yet, explaining
 * what problem LectureLens AI solves and the 3-step workflow.
 */
export function OnboardingEmptyState({ onOpenHelp }: OnboardingEmptyStateProps) {
  return (
    <section
      aria-labelledby="onboarding-heading"
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-indigo-700 uppercase dark:text-indigo-300">
          <BookOpen className="h-3 w-3" aria-hidden="true" />
          Quick Start Guide
        </div>
        <h2
          id="onboarding-heading"
          className="text-sm font-bold text-slate-900 dark:text-slate-100"
        >
          Turn Long Lectures Into Active Study Kits
        </h2>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          Stop scrubbing through 40-minute YouTube videos to review key
          concepts-extract timestamped notes, flashcards, and quizzes privately
          with on-device Gemini Nano and seamless Cloud fallback.
        </p>
      </div>

      <ol className="space-y-2 text-xs text-slate-700 dark:text-slate-200">
        <li className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
            1
          </span>
          <span>
            Open any <strong>YouTube video</strong> or highlight text on a{' '}
            <strong>web article</strong>.
          </span>
        </li>
        <li className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
            2
          </span>
          <span>
            Click <strong>Capture YouTube Transcript</strong> above (or expand{' '}
            <strong>Paste / Selected Text</strong>).
          </span>
        </li>
        <li className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
            3
          </span>
          <span>
            Review <strong>Notes</strong> with clickable timestamps, practice{' '}
            <strong>Flashcards</strong>, take the <strong>Quiz</strong>, and
            export Markdown.
          </span>
        </li>
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
            <Cpu className="h-2.5 w-2.5" aria-hidden="true" />
            Gemini Nano Local
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">
            <Cloud className="h-2.5 w-2.5" aria-hidden="true" />
            Cloud Fallback
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-slate-600 dark:text-slate-300">
            <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
            Local History
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenHelp}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Read Full Guide &amp; Shortcuts
        </button>
      </div>
    </section>
  );
}

import { Check, ClipboardCopy, Download } from 'lucide-react';

/**
 * Props for the sticky Markdown export footer bar.
 */
export interface ExportBarProps {
  canExport: boolean;
  copiedFeedback: boolean;
  onCopyMarkdown: () => void;
  onDownloadMarkdown: () => void;
}

/**
 * Sticky bottom bar for copying or downloading complete study sessions as Markdown.
 */
export function ExportBar({
  canExport,
  copiedFeedback,
  onCopyMarkdown,
  onDownloadMarkdown,
}: ExportBarProps) {
  return (
    <footer className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 px-3.5 py-2.5 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2 sm:justify-end">
        <button
          type="button"
          disabled={!canExport}
          onClick={onCopyMarkdown}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 sm:flex-none sm:min-w-[155px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {copiedFeedback ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Copy Markdown</span>
            </>
          )}
        </button>

        <button
          type="button"
          disabled={!canExport}
          onClick={onDownloadMarkdown}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 sm:flex-none sm:min-w-[155px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Download .md</span>
        </button>
      </div>
    </footer>
  );
}

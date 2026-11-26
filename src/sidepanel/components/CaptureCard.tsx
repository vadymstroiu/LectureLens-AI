import { ChevronDown, ChevronUp, ExternalLink, FileText, Youtube } from 'lucide-react';
import { ALL_CHAPTERS_ID, type ContentWindowAnalysis } from '../../lib/hybridAi';
import type { LectureSession, TranscriptChunk } from '../../types/lecture';

/**
 * Props for the YouTube / article capture card.
 */
export interface CaptureCardProps {
  session: LectureSession | null;
  capturing: boolean;
  autoGenerateOnCapture: boolean;
  windowAnalysis: ContentWindowAnalysis;
  chunks: TranscriptChunk[];
  activeChunkId: string;
  pasteDrawerOpen: boolean;
  pastedTitle: string;
  pastedText: string;
  onCaptureYouTube: () => void;
  onToggleAutoGenerate: (enabled: boolean) => void;
  onTogglePasteDrawer: () => void;
  onChangePastedTitle: (value: string) => void;
  onChangePastedText: (value: string) => void;
  onGrabSelection: () => void;
  onApplyPastedText: () => void;
  onSelectChunk: (chunkId: string) => void;
  onOpenSourceUrl?: (url: string) => void;
}

/**
 * Card for capturing YouTube transcripts, grabbing selected page text, pasting
 * custom study material, and filtering study items by chapter.
 */
export function CaptureCard({
  session,
  capturing,
  autoGenerateOnCapture,
  windowAnalysis,
  chunks,
  activeChunkId,
  pasteDrawerOpen,
  pastedTitle,
  pastedText,
  onCaptureYouTube,
  onToggleAutoGenerate,
  onTogglePasteDrawer,
  onChangePastedTitle,
  onChangePastedText,
  onGrabSelection,
  onApplyPastedText,
  onSelectChunk,
  onOpenSourceUrl,
}: CaptureCardProps) {
  return (
    <section className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button
            type="button"
            disabled={capturing}
            onClick={onCaptureYouTube}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-500 disabled:opacity-50 sm:flex-none sm:min-w-[230px]"
          >
            <Youtube className="h-4 w-4" aria-hidden="true" />
            <span>
              {capturing ? 'Capturing...' : 'Capture YouTube Transcript'}
            </span>
          </button>
        </div>

        <div className="inline-flex items-center gap-2">
          <button
            id="auto-generate-toggle"
            type="button"
            role="switch"
            aria-checked={autoGenerateOnCapture}
            onClick={() => onToggleAutoGenerate(!autoGenerateOnCapture)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
              autoGenerateOnCapture
                ? 'border-indigo-600 bg-indigo-600'
                : 'border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800'
            }`}
            title="Automatically generate Notes, Flashcards, and Quiz (in Hybrid mode) when capturing"
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                autoGenerateOnCapture ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <label
            htmlFor="auto-generate-toggle"
            className="text-[11px] font-medium text-slate-600 select-none dark:text-slate-300"
          >
            Auto-generate study kit
          </label>
        </div>
      </div>

      {/* Collapsible Paste / Selected Text Drawer */}
      <div>
        <button
          type="button"
          aria-expanded={pasteDrawerOpen}
          onClick={onTogglePasteDrawer}
          className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          <span className="inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Paste / Selected Text
          </span>
          {pasteDrawerOpen ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        {pasteDrawerOpen && (
          <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <input
              type="text"
              value={pastedTitle}
              onChange={(e) => onChangePastedTitle(e.target.value)}
              placeholder="Optional title (e.g., Distributed Systems Notes)"
              aria-label="Study material title"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
            <textarea
              rows={4}
              value={pastedText}
              onChange={(e) => onChangePastedText(e.target.value)}
              placeholder="Paste lecture transcript, documentation, or article text..."
              aria-label="Study material text"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onGrabSelection}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none sm:min-w-[140px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Grab Page Selection
              </button>
              <button
                type="button"
                disabled={!pastedText.trim()}
                onClick={onApplyPastedText}
                className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 sm:flex-none sm:min-w-[140px]"
              >
                Use Pasted Text
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Captured Content Summary & Window Indicator */}
      {session && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 flex-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
              {session.content.title}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {session.content.url && onOpenSourceUrl && (
                <button
                  type="button"
                  onClick={() => onOpenSourceUrl(session.content.url)}
                  aria-label="Open original lecture URL"
                  title="Open original lecture URL"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-indigo-300"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
              <span className="rounded-md bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {windowAnalysis.charCount.toLocaleString()} chars
              </span>
            </div>
          </div>

          <p
            className={`text-[11px] font-medium ${
              windowAnalysis.fitsOnDevice
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-sky-600 dark:text-sky-400'
            }`}
          >
            {chunks.length > 1
              ? `Full-lecture coverage across ${chunks.length} chapters • Select a chapter to filter`
              : windowAnalysis.hint}
          </p>

          {chunks.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 dark:border-slate-700">
              <label
                htmlFor="chapter-chunk-select"
                className="text-[11px] font-medium text-slate-600 dark:text-slate-300"
              >
                Chapter Filter:
              </label>
              <select
                id="chapter-chunk-select"
                value={activeChunkId}
                onChange={(e) => onSelectChunk(e.target.value)}
                className="max-w-[235px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value={ALL_CHAPTERS_ID}>
                  All Chapters ({chunks.length} parts)
                </option>
                {chunks.map((chunk) => (
                  <option key={chunk.id} value={chunk.id}>
                    {chunk.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

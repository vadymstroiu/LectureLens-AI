import { BookOpen, Clock, Lightbulb, Loader2, PlusCircle, Sparkles } from 'lucide-react';
import type {
  HybridRoutingPolicy,
  SimpleExplanation,
  StudyNotesData,
  UserNote,
} from '../types/lecture';
import { PersonalNotesSection } from './components/PersonalNotesSection';

interface NotesTabProps {
  notes?: StudyNotesData;
  userNotes?: UserNote[];
  isYouTubeSource?: boolean;
  hasContent: boolean;
  isLoading: boolean;
  policy: HybridRoutingPolicy;
  explanations?: Record<string, SimpleExplanation>;
  explainingKey?: string | null;
  activeChapterLabel?: string;
  totalTakeawaysCount?: number;
  onGenerate: () => void;
  onDeepDiveChapter?: () => void;
  onSeekVideo: (startSeconds: number) => void;
  onExplainConcept?: (key: string, concept: string, context: string) => void;
  onAddUserNote?: (text: string, timestamp?: string, startSeconds?: number) => void;
  onUpdateUserNote?: (
    id: string,
    text: string,
    timestamp?: string,
    startSeconds?: number,
  ) => void;
  onDeleteUserNote?: (id: string) => void;
  onCaptureCurrentTime?: () => Promise<{
    timestamp: string;
    startSeconds: number;
  } | null>;
}

export function NotesTab({
  notes,
  userNotes = [],
  isYouTubeSource = false,
  hasContent,
  isLoading,
  policy,
  explanations = {},
  explainingKey,
  activeChapterLabel,
  totalTakeawaysCount,
  onGenerate,
  onDeepDiveChapter,
  onSeekVideo,
  onExplainConcept,
  onAddUserNote,
  onUpdateUserNote,
  onDeleteUserNote,
  onCaptureCurrentTime,
}: NotesTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <button
          type="button"
          disabled={!hasContent || isLoading}
          onClick={onGenerate}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50 sm:w-auto sm:min-w-[220px]"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>
                Extracting ({policy === 'local-only' ? 'Local-Only' : 'On-Device First'})...
              </span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>
                {notes ? 'Regenerate Full Notes' : 'Extract Key Notes & Terms'}
              </span>
            </>
          )}
        </button>

        {activeChapterLabel && onDeepDiveChapter && (
          <button
            type="button"
            disabled={!hasContent || isLoading}
            onClick={onDeepDiveChapter}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-500/20 disabled:opacity-50 dark:text-indigo-300"
            title={`Extract additional notes specifically from ${activeChapterLabel}`}
          >
            <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Deep-Dive Chapter (+More)</span>
          </button>
        )}
      </div>

      {activeChapterLabel && notes && (
        <div className="flex items-center justify-between rounded-lg bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-800 dark:text-indigo-200">
          <span>
            Filtered: <strong>{activeChapterLabel}</strong> ({notes.takeaways.length} of{' '}
            {totalTakeawaysCount ?? notes.takeaways.length} takeaways)
          </span>
        </div>
      )}

      {!notes && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <BookOpen className="mx-auto mb-2 h-6 w-6 text-indigo-500" aria-hidden="true" />
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Timestamped Study Notes &amp; Glossary
          </p>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
            Runs with <code className="font-mono">PREFER_ON_DEVICE</code> (Gemini Nano) with
            automatic Gemini 3.8 Flash fallback when needed.
          </p>
        </div>
      )}

      {notes && (
        <div className="space-y-4">
          {notes.overview && (
            <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-1 text-[11px] font-semibold tracking-wider text-indigo-700 uppercase dark:text-indigo-400">
                Section Summary
              </h2>
              <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {notes.overview}
              </p>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-400">
              Key Takeaways ({notes.takeaways.length})
            </h2>
            <ul className="space-y-2.5">
              {notes.takeaways.map((item, idx) => (
                <li
                  key={`${item.timestamp}-${idx}`}
                  className="flex items-start gap-2 text-xs leading-relaxed text-slate-700 dark:text-slate-200"
                >
                  {isYouTubeSource ? (
                    <button
                      type="button"
                      onClick={() => onSeekVideo(item.startSeconds)}
                      aria-label={`Jump to lecture timestamp ${item.timestamp}`}
                      className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-500/20 dark:text-indigo-300"
                      title={`Jump to ${item.timestamp}`}
                    >
                      <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                      {item.timestamp}
                    </button>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500/70"
                    />
                  )}
                  <span>{item.point}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-400">
              Key Definitions ({notes.definitions.length})
            </h2>
            <dl className="space-y-2">
              {notes.definitions.map((def, idx) => {
                const explainKey = `def:${def.term}`;
                const explanation = explanations[explainKey];
                const isExplaining = explainingKey === explainKey;

                return (
                  <div
                    key={`${def.term}-${idx}`}
                    className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/70"
                  >
                    <dt className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <span>{def.term}</span>
                      {isYouTubeSource && (
                        <button
                          type="button"
                          onClick={() => onSeekVideo(def.startSeconds)}
                          aria-label={`Jump to lecture timestamp ${def.timestamp}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700 hover:bg-indigo-500/20 hover:text-indigo-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:text-indigo-300"
                        >
                          {def.timestamp}
                        </button>
                      )}
                    </dt>
                    <dd className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                      {def.definition}
                    </dd>

                    {onExplainConcept && !explanation && (
                      <button
                        type="button"
                        disabled={Boolean(explainingKey)}
                        onClick={() =>
                          onExplainConcept(explainKey, def.term, def.definition)
                        }
                        className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-500/20 disabled:opacity-50 dark:text-indigo-300"
                      >
                        {isExplaining ? (
                          <>
                            <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
                            <span>Simplifying...</span>
                          </>
                        ) : (
                          <>
                            <Lightbulb className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>Explain Simply (Nano)</span>
                          </>
                        )}
                      </button>
                    )}

                    {explanation && (
                      <div className="mt-2 space-y-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2 text-[11px] text-emerald-900 dark:text-emerald-200">
                        <p>
                          <span className="font-semibold">Analogy: </span>
                          {explanation.analogy}
                        </p>
                        <p>
                          <span className="font-semibold">Key Idea: </span>
                          {explanation.keyIdea}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      )}

      {hasContent && onAddUserNote && onUpdateUserNote && onDeleteUserNote && (
        <PersonalNotesSection
          notes={userNotes}
          isYouTubeSource={isYouTubeSource}
          onAddNote={onAddUserNote}
          onUpdateNote={onUpdateUserNote}
          onDeleteNote={onDeleteUserNote}
          onSeekVideo={onSeekVideo}
          onCaptureCurrentTime={onCaptureCurrentTime}
        />
      )}
    </div>
  );
}

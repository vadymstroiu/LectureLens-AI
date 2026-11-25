import { BookOpen, Clock, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import type {
  HybridRoutingPolicy,
  SimpleExplanation,
  StudyNotesData,
} from '../types/lecture';

interface NotesTabProps {
  notes?: StudyNotesData;
  hasContent: boolean;
  isLoading: boolean;
  policy: HybridRoutingPolicy;
  explanations?: Record<string, SimpleExplanation>;
  explainingKey?: string | null;
  onGenerate: () => void;
  onSeekVideo: (startSeconds: number) => void;
  onExplainConcept?: (key: string, concept: string, context: string) => void;
}

export function NotesTab({
  notes,
  hasContent,
  isLoading,
  policy,
  explanations = {},
  explainingKey,
  onGenerate,
  onSeekVideo,
  onExplainConcept,
}: NotesTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!hasContent || isLoading}
          onClick={onGenerate}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                Extracting ({policy === 'local-only' ? 'Local-Only' : 'On-Device First'})...
              </span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              <span>Extract Key Notes &amp; Terms</span>
            </>
          )}
        </button>
      </div>

      {!notes && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <BookOpen className="mx-auto mb-2 h-6 w-6 text-indigo-500" />
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Timestamped Study Notes &amp; Glossary
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Runs with <code className="font-mono">PREFER_ON_DEVICE</code> (Gemini Nano) with
            automatic Gemini 3.8 Flash fallback when needed.
          </p>
        </div>
      )}

      {notes && (
        <div className="space-y-4">
          {notes.overview && (
            <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-indigo-600 uppercase dark:text-indigo-400">
                Section Summary
              </h3>
              <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {notes.overview}
              </p>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
              Key Takeaways ({notes.takeaways.length})
            </h3>
            <ul className="space-y-2.5">
              {notes.takeaways.map((item, idx) => (
                <li
                  key={`${item.timestamp}-${idx}`}
                  className="flex items-start gap-2 text-xs leading-relaxed text-slate-700 dark:text-slate-200"
                >
                  <button
                    type="button"
                    onClick={() => onSeekVideo(item.startSeconds)}
                    className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-600 transition hover:bg-indigo-500/20 dark:text-indigo-300"
                    title={`Jump to ${item.timestamp}`}
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {item.timestamp}
                  </button>
                  <span>{item.point}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
              Key Definitions ({notes.definitions.length})
            </h3>
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
                      <button
                        type="button"
                        onClick={() => onSeekVideo(def.startSeconds)}
                        className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700 hover:bg-indigo-500/20 hover:text-indigo-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:text-indigo-300"
                      >
                        {def.timestamp}
                      </button>
                    </dt>
                    <dd className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {def.definition}
                    </dd>

                    {onExplainConcept && !explanation && (
                      <button
                        type="button"
                        disabled={Boolean(explainingKey)}
                        onClick={() =>
                          onExplainConcept(explainKey, def.term, def.definition)
                        }
                        className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 transition hover:bg-indigo-500/20 disabled:opacity-50 dark:text-indigo-300"
                      >
                        {isExplaining ? (
                          <>
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            <span>Simplifying...</span>
                          </>
                        ) : (
                          <>
                            <Lightbulb className="h-2.5 w-2.5" />
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
    </div>
  );
}

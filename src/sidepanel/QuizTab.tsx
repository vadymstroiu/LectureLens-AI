import {
  CheckCircle2,
  Clock,
  Cloud,
  HelpCircle,
  Loader2,
  Lock,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { HybridRoutingPolicy, QuizData } from '../types/lecture';

interface QuizTabProps {
  quiz?: QuizData;
  answers: Record<string, number>;
  hasContent: boolean;
  isLoading: boolean;
  policy: HybridRoutingPolicy;
  onGenerate: () => void;
  onSelectAnswer: (questionId: string, optionIndex: number) => void;
  onResetQuiz: () => void;
  onSeekVideo: (startSeconds: number) => void;
}

export function QuizTab({
  quiz,
  answers,
  hasContent,
  isLoading,
  policy,
  onGenerate,
  onSelectAnswer,
  onResetQuiz,
  onSeekVideo,
}: QuizTabProps) {
  const questions = quiz?.questions ?? [];
  const answeredCount = questions.filter((q) => answers[q.id] !== undefined).length;
  const correctCount = questions.filter(
    (q) => answers[q.id] === q.correctIndex,
  ).length;

  return (
    <div className="space-y-4">
      {policy === 'local-only' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-200">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-semibold">Local-Only Privacy Mode is active.</span>{' '}
            The Full-Lecture Quiz explicitly uses Cloud Gemini 2.5 Flash (
            <code className="font-mono">ONLY_IN_CLOUD</code>) to reason across the entire
            transcript. Clicking below sends the lecture to Firebase AI Logic Cloud.
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!hasContent || isLoading}
        onClick={onGenerate}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Synthesizing Full-Lecture Quiz (Cloud)...</span>
          </>
        ) : (
          <>
            <Cloud className="h-4 w-4" />
            <span>Generate Full-Lecture Quiz (Cloud)</span>
          </>
        )}
      </button>

      {!questions.length && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <HelpCircle className="mx-auto mb-2 h-6 w-6 text-sky-500" />
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            5-Question Full-Lecture Practice Quiz
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Uses <code className="font-mono">ONLY_IN_CLOUD</code> with{' '}
            <code className="font-mono">gemini-2.5-flash</code> to test cross-chapter
            comprehension across long transcripts.
          </p>
        </div>
      )}

      {questions.length > 0 && (
        <div className="space-y-3">
          {/* Score Bar */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
              Score: {correctCount} / {questions.length}{' '}
              <span className="font-normal text-slate-500 dark:text-slate-400">
                ({answeredCount} answered)
              </span>
            </div>
            {answeredCount > 0 && (
              <button
                type="button"
                onClick={onResetQuiz}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>

          {/* Questions */}
          {questions.map((q, qIdx) => {
            const selected = answers[q.id];
            const isAnswered = selected !== undefined;

            return (
              <article
                key={q.id}
                className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs leading-snug font-semibold text-slate-900 dark:text-slate-100">
                    {qIdx + 1}. {q.question}
                  </h4>
                  <button
                    type="button"
                    onClick={() => onSeekVideo(q.startSeconds)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-600 hover:bg-sky-500/20 dark:text-sky-300"
                    title={`Review concept at ${q.timestamp}`}
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {q.timestamp}
                  </button>
                </div>

                <div className="space-y-1.5">
                  {q.options.map((opt, optIdx) => {
                    const isPicked = selected === optIdx;
                    const isCorrectOption = optIdx === q.correctIndex;

                    let style =
                      'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200';
                    if (isAnswered) {
                      if (isCorrectOption) {
                        style =
                          'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200';
                      } else if (isPicked) {
                        style =
                          'border-rose-500/50 bg-rose-500/15 text-rose-800 dark:text-rose-200';
                      } else {
                        style =
                          'border-slate-200 bg-slate-50/50 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500';
                      }
                    }

                    return (
                      <button
                        key={`${q.id}-opt-${optIdx}`}
                        type="button"
                        disabled={isAnswered}
                        onClick={() => onSelectAnswer(q.id, optIdx)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${style}`}
                      >
                        <span>{opt}</span>
                        {isAnswered && isCorrectOption && (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        )}
                        {isAnswered && isPicked && !isCorrectOption && (
                          <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {isAnswered && (
                  <p className="rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      Explanation:{' '}
                    </span>
                    {q.explanation}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

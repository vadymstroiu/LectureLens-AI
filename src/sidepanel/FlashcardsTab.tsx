import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  PlusCircle,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import type { FlashcardsData, HybridRoutingPolicy } from '../types/lecture';

interface FlashcardsTabProps {
  flashcards?: FlashcardsData;
  masteredCardIds: string[];
  isYouTubeSource?: boolean;
  hasContent: boolean;
  isLoading: boolean;
  policy: HybridRoutingPolicy;
  activeChapterLabel?: string;
  totalCardsCount?: number;
  onGenerate: () => void;
  onDeepDiveChapter?: () => void;
  onToggleMastered: (cardId: string) => void;
  onResetMastered?: () => void;
  onSeekVideo: (startSeconds: number) => void;
}

export function FlashcardsTab({
  flashcards,
  masteredCardIds,
  isYouTubeSource = false,
  hasContent,
  isLoading,
  policy,
  activeChapterLabel,
  totalCardsCount,
  onGenerate,
  onDeepDiveChapter,
  onToggleMastered,
  onResetMastered,
  onSeekVideo,
}: FlashcardsTabProps) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Best practice for active recall: hide mastered cards by default to focus on unmastered queue
  const [hideMastered, setHideMastered] = useState(true);

  const cards = flashcards?.cards ?? [];
  const visibleCards = hideMastered
    ? cards.filter((c) => !masteredCardIds.includes(c.id))
    : cards;

  const safeIndex =
    visibleCards.length > 0 ? Math.min(index, visibleCards.length - 1) : 0;
  const activeCard = visibleCards[safeIndex];
  const masteredCount = cards.filter((c) => masteredCardIds.includes(c.id)).length;
  const isMastered = activeCard ? masteredCardIds.includes(activeCard.id) : false;

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [flashcards, activeChapterLabel]);

  useEffect(() => {
    setIndex((prev) =>
      visibleCards.length > 0 ? Math.min(prev, visibleCards.length - 1) : 0,
    );
    setFlipped(false);
  }, [hideMastered, visibleCards.length]);

  const goPrev = useCallback(() => {
    if (!visibleCards.length) return;
    setFlipped(false);
    setIndex((prev) => (prev - 1 + visibleCards.length) % visibleCards.length);
  }, [visibleCards.length]);

  const goNext = useCallback(() => {
    if (!visibleCards.length) return;
    setFlipped(false);
    setIndex((prev) => (prev + 1) % visibleCards.length);
  }, [visibleCards.length]);

  const handleToggleMasteredAndAdvance = useCallback(() => {
    if (!activeCard) return;
    const wasMastered = masteredCardIds.includes(activeCard.id);
    setFlipped(false);
    onToggleMastered(activeCard.id);

    // When showing all cards, manually advance to the next card;
    // when hiding mastered cards, removing the card naturally reveals the next one at safeIndex.
    if (!wasMastered && !hideMastered && visibleCards.length > 1) {
      setIndex((prev) => (prev + 1) % visibleCards.length);
    }
  }, [activeCard, hideMastered, masteredCardIds, onToggleMastered, visibleCards.length]);

  useEffect(() => {
    if (!activeCard) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === ' ') {
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) {
          return;
        }
        e.preventDefault();
        setFlipped((prev) => !prev);
      } else if (e.key === 'ArrowLeft') {
        if (target?.closest('[role="tablist"]')) return;
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        if (target?.closest('[role="tablist"]')) return;
        e.preventDefault();
        goNext();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMasteredAndAdvance();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCard, goNext, goPrev, handleToggleMasteredAndAdvance]);

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
                Creating Cards ({policy === 'local-only' ? 'Local-Only' : 'On-Device First'})...
              </span>
            </>
          ) : (
            <>
              <Layers className="h-4 w-4" aria-hidden="true" />
              <span>
                {cards.length > 0
                  ? 'Regenerate Full Flashcards'
                  : 'Create Active-Recall Cards'}
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
            title={`Generate extra flashcards specifically from ${activeChapterLabel}`}
          >
            <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Deep-Dive Chapter (+More)</span>
          </button>
        )}
      </div>

      {activeChapterLabel && (totalCardsCount ?? cards.length) > 0 && (
        <div className="rounded-lg bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-800 dark:text-indigo-200">
          Filtered: <strong>{activeChapterLabel}</strong> ({cards.length} of{' '}
          {totalCardsCount ?? cards.length} cards)
        </div>
      )}

      {!cards.length && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <Layers className="mx-auto mb-2 h-6 w-6 text-indigo-500" aria-hidden="true" />
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Interactive Active-Recall Flashcards
          </p>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
            Generate front/back recall cards linked to exact lecture timestamps and export to
            Markdown.
          </p>
        </div>
      )}

      {cards.length > 0 && (
        <div className="mx-auto w-full max-w-lg space-y-3">
          {/* Progress Bar + Hide/Show Mastered Toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <span aria-live="polite">
                {visibleCards.length > 0
                  ? `Card ${safeIndex + 1} of ${visibleCards.length}`
                  : 'All caught up'}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {masteredCount} / {cards.length} Mastered
                </span>
                <button
                  type="button"
                  aria-pressed={!hideMastered}
                  onClick={() => setHideMastered((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  title={
                    hideMastered
                      ? 'Show mastered cards in deck'
                      : 'Hide mastered cards to focus on remaining cards'
                  }
                >
                  {hideMastered ? (
                    <>
                      <Eye className="h-2.5 w-2.5" aria-hidden="true" />
                      Show mastered
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-2.5 w-2.5" aria-hidden="true" />
                      Hide mastered
                    </>
                  )}
                </button>
              </div>
            </div>
            <div
              role="progressbar"
              aria-label="Flashcard mastery progress"
              aria-valuenow={masteredCount}
              aria-valuemin={0}
              aria-valuemax={cards.length}
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: `${cards.length ? (masteredCount / cards.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {activeCard ? (
            <>
              {/* 3D Flip Card (semantic button + sibling timestamp chip with zero nested buttons) */}
              <div className="relative">
                {flipped && isYouTubeSource && (
                  <button
                    type="button"
                    onClick={() => onSeekVideo(activeCard.startSeconds)}
                    aria-label={`Jump to lecture timestamp ${activeCard.timestamp}`}
                    className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 shadow-xs ring-1 ring-indigo-500/20 hover:bg-indigo-50 dark:bg-slate-800 dark:text-indigo-300 dark:hover:bg-slate-700"
                    title={`Jump to ${activeCard.timestamp}`}
                  >
                    <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                    {activeCard.timestamp}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setFlipped((prev) => !prev)}
                  aria-pressed={flipped}
                  aria-label={
                    flipped
                      ? `Answer: ${activeCard.back}. Click to flip back to question.`
                      : `Question: ${activeCard.front}. Click to reveal answer.`
                  }
                  className="perspective-1000 block w-full text-left"
                >
                  <div
                    className={`preserve-3d relative min-h-[190px] w-full transition-transform duration-500 ${
                      flipped ? 'rotate-y-180' : ''
                    }`}
                  >
                    {/* Front */}
                    <div
                      aria-hidden={flipped}
                      className="backface-hidden absolute inset-0 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="flex items-center justify-between">
                        <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-indigo-700 uppercase dark:text-indigo-300">
                          Question / Prompt
                        </span>
                        {isMastered && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Mastered
                          </span>
                        )}
                      </div>
                      <p className="my-3 text-center text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
                        {activeCard.front}
                      </p>
                      <div className="flex items-center justify-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                        <RotateCw className="h-3 w-3" aria-hidden="true" />
                        <span>Click card to reveal answer</span>
                      </div>
                    </div>

                    {/* Back */}
                    <div
                      aria-hidden={!flipped}
                      className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col justify-between rounded-2xl border border-indigo-500/30 bg-indigo-50/70 p-4 shadow-sm dark:border-indigo-500/40 dark:bg-slate-900"
                    >
                      <div
                        className={`flex items-center justify-between ${
                          isYouTubeSource ? 'pr-16' : ''
                        }`}
                      >
                        <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-800 uppercase dark:text-emerald-300">
                          Answer
                        </span>
                      </div>
                      <p className="my-3 text-center text-xs leading-relaxed font-medium text-slate-800 dark:text-slate-200">
                        {activeCard.back}
                      </p>
                      <div className="flex items-center justify-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                        <RotateCw className="h-3 w-3" aria-hidden="true" />
                        <span>Click to flip back</span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </button>

                <button
                  type="button"
                  aria-pressed={isMastered}
                  onClick={handleToggleMasteredAndAdvance}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    isMastered
                      ? 'bg-emerald-500/15 text-emerald-800 ring-1 ring-emerald-500/30 dark:text-emerald-300'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {isMastered ? 'Mastered' : 'Mark Mastered'}
                </button>

                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <p className="text-center text-[10px] text-slate-600 dark:text-slate-400">
                Shortcuts: Space flip • ←/→ nav • M master
              </p>
            </>
          ) : (
            <div className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  All {cards.length} flashcards mastered!
                </p>
                <p className="mt-1 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                  Mastered cards are hidden so you can focus on what still needs practice.
                </p>
              </div>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setHideMastered(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-slate-800"
                >
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  Review All Cards
                </button>
                {onResetMastered && (
                  <button
                    type="button"
                    onClick={onResetMastered}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Reset Mastery
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

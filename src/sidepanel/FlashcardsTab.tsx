import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import type { FlashcardsData, HybridRoutingPolicy } from '../types/lecture';

interface FlashcardsTabProps {
  flashcards?: FlashcardsData;
  masteredCardIds: string[];
  hasContent: boolean;
  isLoading: boolean;
  policy: HybridRoutingPolicy;
  onGenerate: () => void;
  onToggleMastered: (cardId: string) => void;
  onResetMastered?: () => void;
  onSeekVideo: (startSeconds: number) => void;
}

export function FlashcardsTab({
  flashcards,
  masteredCardIds,
  hasContent,
  isLoading,
  policy,
  onGenerate,
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
  }, [flashcards]);

  useEffect(() => {
    setIndex((prev) =>
      visibleCards.length > 0 ? Math.min(prev, visibleCards.length - 1) : 0,
    );
    setFlipped(false);
  }, [hideMastered, visibleCards.length]);

  const goPrev = () => {
    if (!visibleCards.length) return;
    setFlipped(false);
    setIndex((prev) => (prev - 1 + visibleCards.length) % visibleCards.length);
  };

  const goNext = () => {
    if (!visibleCards.length) return;
    setFlipped(false);
    setIndex((prev) => (prev + 1) % visibleCards.length);
  };

  const handleToggleMasteredAndAdvance = () => {
    if (!activeCard) return;
    const wasMastered = masteredCardIds.includes(activeCard.id);
    setFlipped(false);
    onToggleMastered(activeCard.id);

    // When showing all cards, manually advance to the next card;
    // when hiding mastered cards, removing the card naturally reveals the next one at safeIndex.
    if (!wasMastered && !hideMastered && visibleCards.length > 1) {
      setIndex((prev) => (prev + 1) % visibleCards.length);
    }
  };

  return (
    <div className="space-y-4">
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
              Creating Cards ({policy === 'local-only' ? 'Local-Only' : 'On-Device First'})...
            </span>
          </>
        ) : (
          <>
            <Layers className="h-4 w-4" />
            <span>Create Active-Recall Cards</span>
          </>
        )}
      </button>

      {!cards.length && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <Layers className="mx-auto mb-2 h-6 w-6 text-indigo-500" />
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Interactive Active-Recall Flashcards
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Generate front/back recall cards linked to exact lecture timestamps and export to
            Anki CSV.
          </p>
        </div>
      )}

      {cards.length > 0 && (
        <div className="space-y-3">
          {/* Progress Bar + Hide/Show Mastered Toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                {visibleCards.length > 0
                  ? `Card ${safeIndex + 1} of ${visibleCards.length}`
                  : 'All caught up'}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {masteredCount} / {cards.length} Mastered
                </span>
                <button
                  type="button"
                  onClick={() => setHideMastered((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  title={
                    hideMastered
                      ? 'Show mastered cards in deck'
                      : 'Hide mastered cards to focus on remaining cards'
                  }
                >
                  {hideMastered ? (
                    <>
                      <Eye className="h-2.5 w-2.5" />
                      Show mastered
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-2.5 w-2.5" />
                      Hide mastered
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
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
              {/* 3D Flip Card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setFlipped((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setFlipped((prev) => !prev);
                  }
                }}
                className="perspective-1000 cursor-pointer focus:outline-none"
                aria-label="Flip flashcard"
              >
                <div
                  className={`preserve-3d relative min-h-[190px] w-full transition-transform duration-500 ${
                    flipped ? 'rotate-y-180' : ''
                  }`}
                >
                  {/* Front */}
                  <div className="backface-hidden absolute inset-0 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between">
                      <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-indigo-600 uppercase dark:text-indigo-300">
                        Question / Prompt
                      </span>
                      {isMastered && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Mastered
                        </span>
                      )}
                    </div>
                    <p className="my-3 text-center text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
                      {activeCard.front}
                    </p>
                    <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                      <RotateCw className="h-3 w-3" />
                      <span>Click card to reveal answer</span>
                    </div>
                  </div>

                  {/* Back */}
                  <div className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col justify-between rounded-2xl border border-indigo-500/30 bg-indigo-50/70 p-4 shadow-sm dark:border-indigo-500/40 dark:bg-slate-900">
                    <div className="flex items-center justify-between">
                      <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-300">
                        Answer
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeekVideo(activeCard.startSeconds);
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-600 shadow-xs hover:bg-indigo-50 dark:bg-slate-800 dark:text-indigo-300"
                        title={`Jump to ${activeCard.timestamp}`}
                      >
                        <Clock className="h-2.5 w-2.5" />
                        {activeCard.timestamp}
                      </button>
                    </div>
                    <p className="my-3 text-center text-xs leading-relaxed font-medium text-slate-800 dark:text-slate-200">
                      {activeCard.back}
                    </p>
                    <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                      <RotateCw className="h-3 w-3" />
                      <span>Click to flip back</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </button>

                <button
                  type="button"
                  onClick={handleToggleMasteredAndAdvance}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    isMastered
                      ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {isMastered ? 'Mastered' : 'Mark Mastered'}
                </button>

                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
              <div>
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  All {cards.length} flashcards mastered!
                </p>
                <p className="mt-1 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                  Mastered cards are hidden so you can focus on what still needs practice.
                </p>
              </div>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setHideMastered(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:bg-slate-900 dark:text-emerald-300"
                >
                  <Eye className="h-3 w-3" />
                  Review All Cards
                </button>
                {onResetMastered && (
                  <button
                    type="button"
                    onClick={onResetMastered}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                  >
                    <RotateCcw className="h-3 w-3" />
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

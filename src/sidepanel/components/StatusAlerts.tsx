import {
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Square,
  Zap,
} from 'lucide-react';
import {
  computePipelineExecutionProgress,
  formatLatency,
} from '../../lib/hybridAi';
import type {
  HybridRoutingPolicy,
  OnDeviceAvailability,
  PipelineProgress,
} from '../../types/lecture';

/**
 * Structured error state displayed inside the Side Panel alert banner.
 */
export interface ErrorBannerState {
  message: string;
  hint?: string;
  code?: string;
}

/**
 * Props for progress, Gemini Nano download, status, and error alerts.
 */
export interface StatusAlertsProps {
  loadingTask: 'notes' | 'flashcards' | 'quiz' | null;
  pipelineProgress?: PipelineProgress | null;
  downloadingNano: boolean;
  downloadProgress: number | null;
  elapsedMs: number;
  chapterElapsedMs?: number;
  isStopping?: boolean;
  onDeviceStatus: OnDeviceAvailability;
  policy: HybridRoutingPolicy;
  statusBanner: string | null;
  errorState: ErrorBannerState | null;
  onDownloadNano: () => void;
  onSwitchToHybrid: () => void;
  onRecheckOrDownloadNano: () => void;
  onOpenChromePage: (url: string) => void;
  onCancelGeneration?: () => void;
  onCancelDownload?: () => void;
}

/**
 * Renders live AI execution/download progress, Gemini Nano availability
 * banners, polite status messages, and actionable error recovery prompts.
 */
export function StatusAlerts({
  loadingTask,
  pipelineProgress,
  downloadingNano,
  downloadProgress,
  elapsedMs,
  chapterElapsedMs,
  isStopping = false,
  onDeviceStatus,
  policy,
  statusBanner,
  errorState,
  onDownloadNano,
  onSwitchToHybrid,
  onRecheckOrDownloadNano,
  onOpenChromePage,
  onCancelGeneration,
  onCancelDownload,
}: StatusAlertsProps) {
  return (
    <>
      {/* Live Execution / Download Progress Card */}
      {(loadingTask !== null || downloadingNano) &&
        (() => {
          const isNanoDl = downloadProgress !== null && downloadProgress < 100;
          const isStoppingGeneration = !isNanoDl && isStopping;
          const execProgress = computePipelineExecutionProgress({
            elapsedMs,
            chapterElapsedMs,
            chapterIndex: pipelineProgress?.chapterIndex,
            totalChapters: pipelineProgress?.totalChapters,
            expectedMs:
              loadingTask === 'quiz'
                ? 6500
                : pipelineProgress?.totalChapters &&
                    pipelineProgress.totalChapters > 1
                  ? 15000
                  : 4500,
          });
          const currentPct = isNanoDl ? downloadProgress : execProgress.percent;
          const baseTaskTitle =
            loadingTask === 'notes'
              ? 'Extracting Study Notes'
              : loadingTask === 'flashcards'
                ? 'Creating Flashcards'
                : 'Generating Cloud Quiz';
          const stepPrefix = pipelineProgress
            ? `Step ${pipelineProgress.stageIndex}/${pipelineProgress.totalStages}: `
            : '';
          const chapterSuffix =
            pipelineProgress?.chapterIndex && pipelineProgress?.totalChapters
              ? ` (Chapter ${pipelineProgress.chapterIndex}/${pipelineProgress.totalChapters})`
              : '';
          const taskTitle = isNanoDl
            ? 'Downloading Gemini Nano'
            : `${stepPrefix}${baseTaskTitle}${chapterSuffix}`;

          return (
            <div
              role="status"
              aria-live="polite"
              className="space-y-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2 font-semibold text-indigo-800 dark:text-indigo-200">
                <span className="truncate">{taskTitle}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px]">{currentPct}%</span>
                  {(() => {
                    const cancelHandler = isNanoDl
                      ? onCancelDownload
                      : onCancelGeneration;
                    if (!cancelHandler) return null;
                    return (
                      <button
                        type="button"
                        disabled={isStoppingGeneration}
                        onClick={cancelHandler}
                        className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-500/30 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-75 dark:text-rose-300"
                        title={
                          isNanoDl
                            ? 'Stop tracking download (Chrome may continue downloading in the background)'
                            : isStoppingGeneration
                              ? 'Stopping generation…'
                              : 'Stop current generation'
                        }
                      >
                        {isStoppingGeneration ? (
                          <Loader2
                            className="h-2.5 w-2.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Square
                            className="h-2.5 w-2.5 fill-current"
                            aria-hidden="true"
                          />
                        )}
                        {isStoppingGeneration ? 'Stopping…' : 'Stop'}
                      </button>
                    );
                  })()}
                </div>
              </div>
              <div
                role="progressbar"
                aria-label={taskTitle}
                aria-valuenow={currentPct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 w-full overflow-hidden rounded-full bg-indigo-200/70 dark:bg-slate-800"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-150"
                  style={{ width: `${currentPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-indigo-700/80 dark:text-indigo-300/80">
                <span>
                  {isNanoDl
                    ? 'One-time Chrome on-device model download'
                    : isStoppingGeneration
                      ? 'Stopping generation and saving completed progress…'
                      : policy === 'local-only' && loadingTask !== 'quiz'
                        ? 'Running on-device (Local-Only)'
                        : 'Running via Firebase AI Logic'}
                </span>
                <span className="font-mono">{formatLatency(elapsedMs)} elapsed</span>
              </div>
            </div>
          );
        })()}

      {/* Gemini Nano Downloadable Banner */}
      {(onDeviceStatus === 'downloadable' ||
        (onDeviceStatus === 'downloading' &&
          !downloadingNano &&
          downloadProgress !== 100)) && (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-200">
          <p className="font-semibold">
            {onDeviceStatus === 'downloading'
              ? 'Chrome is downloading Gemini Nano in the background'
              : 'Gemini Nano is ready to download (~1.7 GB)'}
            {typeof downloadProgress === 'number' ? ` (${downloadProgress}%)` : ''}
          </p>
          <p className="leading-relaxed opacity-90">
            {policy === 'local-only'
              ? 'Local-Only mode is active. Track live download % below, or switch to Hybrid for Cloud fallback anytime.'
              : 'Hybrid mode will automatically use Cloud fallback until Nano finishes downloading.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {!loadingTask && (
              <button
                type="button"
                onClick={onDownloadNano}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-500"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                Track / Download Gemini Nano
              </button>
            )}
            {policy === 'local-only' && (
              <button
                type="button"
                onClick={onSwitchToHybrid}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
              >
                <Zap className="h-3 w-3" aria-hidden="true" />
                Switch to Hybrid
              </button>
            )}
          </div>
        </div>
      )}

      {statusBanner && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-700 dark:text-indigo-200"
        >
          {statusBanner}
        </div>
      )}

      {errorState && (
        <div
          role="alert"
          className="space-y-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-200"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-rose-500"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="font-semibold">{errorState.message}</p>
              {errorState.hint && (
                <p className="text-[11px] leading-relaxed opacity-90">
                  {errorState.hint}
                </p>
              )}
            </div>
          </div>
          {errorState.code === 'ON_DEVICE_UNAVAILABLE' && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={onSwitchToHybrid}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
              >
                <Zap className="h-3 w-3" aria-hidden="true" />
                Switch to Hybrid (Auto Cloud Fallback)
              </button>
              <button
                type="button"
                onClick={onRecheckOrDownloadNano}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-500"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Check / Download Nano
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenChromePage(
                    'chrome://flags/#optimization-guide-on-device-model',
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-white/80 px-2 py-1 text-[10px] font-semibold text-rose-800 hover:bg-white dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-slate-800"
              >
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                1. Model Flag
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenChromePage('chrome://flags/#prompt-api-for-gemini-nano')
                }
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-white/80 px-2 py-1 text-[10px] font-semibold text-rose-800 hover:bg-white dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-slate-800"
              >
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                2. Prompt API Flag
              </button>
              <button
                type="button"
                onClick={() => onOpenChromePage('chrome://components')}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-white/80 px-2 py-1 text-[10px] font-semibold text-rose-800 hover:bg-white dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-slate-800"
              >
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                3. Components
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

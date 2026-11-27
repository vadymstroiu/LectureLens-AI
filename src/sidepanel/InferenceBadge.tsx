import { useEffect, useRef, useState } from 'react';
import { Cloud, Cpu, History, WifiOff, Zap } from 'lucide-react';
import type {
  HybridRoutingPolicy,
  InferenceTelemetry,
  OnDeviceAvailability,
} from '../types/lecture';
import { formatLatency, summarizeTelemetry } from '../lib/hybridAi';

interface InferenceBadgeProps {
  telemetry?: InferenceTelemetry;
  history: InferenceTelemetry[];
  onDeviceStatus: OnDeviceAvailability;
  policy: HybridRoutingPolicy;
  isOnline?: boolean;
}

export function InferenceBadge({
  telemetry,
  history,
  onDeviceStatus,
  policy,
  isOnline = true,
}: InferenceBadgeProps) {
  const [showLog, setShowLog] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const summary = summarizeTelemetry(history);

  useEffect(() => {
    if (!showLog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowLog(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowLog(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [showLog]);

  const renderPrimaryBadge = () => {
    if (telemetry) {
      const isLocal = telemetry.source === 'ON_DEVICE';
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight ring-1 transition-colors ${
            isLocal
              ? 'bg-emerald-500/15 text-emerald-800 ring-emerald-500/30 dark:text-emerald-300'
              : 'bg-sky-500/15 text-sky-800 ring-sky-500/30 dark:text-sky-300'
          }`}
          title={`Last run: ${telemetry.task} via ${telemetry.modelLabel} in ${Math.round(telemetry.latencyMs)}ms`}
        >
          {isLocal ? (
            <Zap className="h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />
          ) : (
            <Cloud className="h-3 w-3 shrink-0 text-sky-500" aria-hidden="true" />
          )}
          <span>
            {isLocal ? 'On-Device (Gemini Nano)' : 'Cloud (Gemini)'} •{' '}
            {formatLatency(telemetry.latencyMs)}
          </span>
        </span>
      );
    }

    const ready = onDeviceStatus === 'available';
    const label = ready
      ? 'Gemini Nano Ready'
      : onDeviceStatus === 'downloading'
        ? 'Nano Downloading'
        : policy === 'local-only'
          ? 'Nano Required (Local-Only)'
          : 'Nano Unavailable • Cloud Fallback';

    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
          ready
            ? 'bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300'
            : 'bg-slate-500/10 text-slate-700 ring-slate-400/30 dark:text-slate-300'
        }`}
      >
        <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  };

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-1.5">
      {renderPrimaryBadge()}
      {!isOnline && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-500/30 dark:text-amber-300"
          title="Browser is offline — Local Gemini Nano & cached sessions remain available"
        >
          <WifiOff className="h-2.5 w-2.5" aria-hidden="true" />
          Offline
        </span>
      )}
      {history.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLog((prev) => !prev)}
          aria-expanded={showLog}
          aria-controls="telemetry-log-popover"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          title="View hybrid inference telemetry summary & log"
          aria-label="Toggle telemetry history"
        >
          <History className="h-3 w-3" aria-hidden="true" />
        </button>
      )}

      {showLog && history.length > 0 && (
        <div
          id="telemetry-log-popover"
          role="region"
          aria-label="Hybrid inference telemetry summary"
          className="absolute top-8 left-0 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-400">
            <span>Hybrid Telemetry ({summary.onDevicePercent}% Local)</span>
            <button
              type="button"
              onClick={() => setShowLog(false)}
              className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Close
            </button>
          </div>

          <div className="mb-2 grid grid-cols-2 gap-1.5 rounded-lg bg-slate-50 p-2 text-[10px] dark:bg-slate-800/80">
            <div>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                ⚡ Local: {summary.localCount}
              </span>
              <p className="text-slate-600 dark:text-slate-400">
                {summary.localCount > 0
                  ? `avg ${formatLatency(summary.avgLocalMs)}`
                  : 'no calls yet'}
              </p>
            </div>
            <div>
              <span className="font-semibold text-sky-700 dark:text-sky-400">
                ☁️ Cloud: {summary.cloudCount}
              </span>
              <p className="text-slate-600 dark:text-slate-400">
                {summary.cloudCount > 0
                  ? `avg ${formatLatency(summary.avgCloudMs)}`
                  : 'no calls yet'}
              </p>
            </div>
          </div>

          <p className="mb-1 text-[10px] font-medium text-slate-600 dark:text-slate-400">
            Recent Calls ({history.length})
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-0.5">
            {history.map((entry, idx) => (
              <li
                key={`${entry.timestamp}-${idx}`}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-[11px] dark:bg-slate-800/70"
              >
                <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                  {entry.source === 'ON_DEVICE' ? (
                    <Zap className="h-3 w-3 text-amber-500" aria-hidden="true" />
                  ) : (
                    <Cloud className="h-3 w-3 text-sky-500" aria-hidden="true" />
                  )}
                  <span className="capitalize">{entry.task}</span>
                </span>
                <span className="text-slate-600 dark:text-slate-400">
                  {entry.source === 'ON_DEVICE' ? 'Nano' : 'Cloud'} •{' '}
                  {formatLatency(entry.latencyMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

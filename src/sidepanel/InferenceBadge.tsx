import { useState } from 'react';
import { Cloud, Cpu, History, Zap } from 'lucide-react';
import type {
  HybridRoutingPolicy,
  InferenceTelemetry,
  OnDeviceAvailability,
} from '../types/lecture';
import { formatLatency } from '../lib/hybridAi';

interface InferenceBadgeProps {
  telemetry?: InferenceTelemetry;
  history: InferenceTelemetry[];
  onDeviceStatus: OnDeviceAvailability;
  policy: HybridRoutingPolicy;
  downloadProgress?: number | null;
}

export function InferenceBadge({
  telemetry,
  history,
  onDeviceStatus,
  policy,
  downloadProgress,
}: InferenceBadgeProps) {
  const [showLog, setShowLog] = useState(false);

  const renderPrimaryBadge = () => {
    if (telemetry) {
      const isLocal = telemetry.source === 'ON_DEVICE';
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight ring-1 transition-colors ${
            isLocal
              ? 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300'
              : 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300'
          }`}
          title={`Last run: ${telemetry.task} via ${telemetry.modelLabel} in ${Math.round(telemetry.latencyMs)}ms`}
        >
          {isLocal ? (
            <Zap className="h-3 w-3 shrink-0 text-amber-500" />
          ) : (
            <Cloud className="h-3 w-3 shrink-0 text-sky-500" />
          )}
          <span>
            {isLocal ? 'On-Device (Gemini Nano)' : 'Cloud (Gemini)'} •{' '}
            {formatLatency(telemetry.latencyMs)}
          </span>
        </span>
      );
    }

    const ready = onDeviceStatus === 'available';
    const progressSuffix =
      typeof downloadProgress === 'number' && downloadProgress >= 0
        ? ` (${downloadProgress}%)`
        : '';
    const label = ready
      ? 'Gemini Nano Ready'
      : onDeviceStatus === 'downloading'
        ? `Nano Downloading${progressSuffix}`
        : policy === 'local-only'
          ? 'Nano Required (Local-Only)'
          : 'Nano Unavailable • Cloud Fallback';

    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
          ready
            ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300'
            : 'bg-slate-500/10 text-slate-600 ring-slate-400/30 dark:text-slate-300'
        }`}
      >
        <Cpu className="h-3 w-3 shrink-0" />
        <span>{label}</span>
      </span>
    );
  };

  return (
    <div className="relative flex items-center gap-1.5">
      {renderPrimaryBadge()}
      {history.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLog((prev) => !prev)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          title="View hybrid inference telemetry log"
          aria-label="Toggle telemetry history"
        >
          <History className="h-3 w-3" />
        </button>
      )}

      {showLog && history.length > 0 && (
        <div className="absolute top-8 left-0 z-30 w-68 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
            <span>Recent Inference Calls</span>
            <button
              type="button"
              onClick={() => setShowLog(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              Close
            </button>
          </div>
          <ul className="space-y-1">
            {history.slice(0, 5).map((entry, idx) => (
              <li
                key={`${entry.timestamp}-${idx}`}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-[11px] dark:bg-slate-800/70"
              >
                <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                  {entry.source === 'ON_DEVICE' ? (
                    <Zap className="h-3 w-3 text-amber-500" />
                  ) : (
                    <Cloud className="h-3 w-3 text-sky-500" />
                  )}
                  <span className="capitalize">{entry.task}</span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
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

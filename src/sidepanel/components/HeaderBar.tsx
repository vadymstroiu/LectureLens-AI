import {
  HardDrive,
  HelpCircle,
  History,
  Moon,
  ShieldCheck,
  Sun,
  Zap,
} from 'lucide-react';
import type {
  HybridRoutingPolicy,
  LectureSession,
  OnDeviceAvailability,
} from '../../types/lecture';
import { InferenceBadge } from '../InferenceBadge';
import { BrandLogo } from './BrandLogo';

/**
 * Props for the sticky Side Panel header bar.
 */
export interface HeaderBarProps {
  policy: HybridRoutingPolicy;
  theme: 'light' | 'dark';
  onDeviceStatus: OnDeviceAvailability;
  isOnline: boolean;
  session: LectureSession | null;
  savedSessionCount: number;
  libraryOpen: boolean;
  helpOpen: boolean;
  onChangePolicy: (policy: HybridRoutingPolicy) => void;
  onToggleTheme: () => void;
  onToggleLibrary: () => void;
  onOpenHelp: () => void;
}

/**
 * Sticky Side Panel header displaying the LectureLens AI brand mark, hybrid
 * routing policy toggle, how-to-use help button, theme toggle, and telemetry.
 */
export function HeaderBar({
  policy,
  theme,
  onDeviceStatus,
  isOnline,
  session,
  savedSessionCount,
  libraryOpen,
  helpOpen,
  onChangePolicy,
  onToggleTheme,
  onToggleLibrary,
  onOpenHelp,
}: HeaderBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-3.5 py-2.5 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrandLogo size={28} className="shrink-0 rounded-lg shadow-xs" />
            <div>
              <h1 className="text-sm font-bold tracking-tight">LectureLens AI</h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Hybrid vs Local-Only Toggle Pill */}
            <div
              className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-0.5 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-900"
              role="group"
              aria-label="Hybrid routing policy"
            >
              <button
                type="button"
                aria-pressed={policy === 'hybrid'}
                onClick={() => onChangePolicy('hybrid')}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition ${
                  policy === 'hybrid'
                    ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-800 dark:text-indigo-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title="Prefer Gemini Nano on-device with automatic Cloud Gemini 3.8 Flash fallback"
              >
                <Zap className="h-2.5 w-2.5" aria-hidden="true" />
                Hybrid
              </button>
              <button
                type="button"
                aria-pressed={policy === 'local-only'}
                onClick={() => onChangePolicy('local-only')}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition ${
                  policy === 'local-only'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                title="Strict Local-Only (Offline Privacy) — ONLY_ON_DEVICE"
              >
                <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                Local-Only
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenHelp}
              aria-expanded={helpOpen}
              aria-label="How to use LectureLens AI"
              title="How to use & what LectureLens AI solves"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Toggle light/dark theme"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Live Telemetry & Inference Source Row */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
          <InferenceBadge
            telemetry={session?.lastTelemetry}
            history={session?.telemetryHistory ?? []}
            onDeviceStatus={onDeviceStatus}
            policy={policy}
            isOnline={isOnline}
          />
          <div className="flex items-center gap-1.5">
            {savedSessionCount > 0 ? (
              <button
                type="button"
                aria-expanded={libraryOpen}
                aria-controls="study-history-drawer"
                onClick={onToggleLibrary}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Browse locally saved study history"
              >
                <History className="h-2.5 w-2.5 text-indigo-500" aria-hidden="true" />
                History ({savedSessionCount})
              </button>
            ) : (
              session && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  <HardDrive className="h-2.5 w-2.5" aria-hidden="true" />
                  Saved
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Clock, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react';
import { normalizeOptionalTimestamp } from '../../content/youtubeTranscriptParser';
import type { UserNote } from '../../types/lecture';

/**
 * Props for the personal user-authored notes section inside `NotesTab`.
 */
export interface PersonalNotesSectionProps {
  notes: UserNote[];
  isYouTubeSource: boolean;
  onAddNote: (text: string, timestamp?: string, startSeconds?: number) => void;
  onUpdateNote: (
    id: string,
    text: string,
    timestamp?: string,
    startSeconds?: number,
  ) => void;
  onDeleteNote: (id: string) => void;
  onSeekVideo: (startSeconds: number) => void;
  onCaptureCurrentTime?: () => Promise<{
    timestamp: string;
    startSeconds: number;
  } | null>;
}

/**
 * Allows learners to add, timestamp, edit, and delete personal study notes
 * persisted locally alongside AI-generated lecture notes.
 */
export function PersonalNotesSection({
  notes,
  isYouTubeSource,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onSeekVideo,
  onCaptureCurrentTime,
}: PersonalNotesSectionProps) {
  const [draftText, setDraftText] = useState('');
  const [draftTimestamp, setDraftTimestamp] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [stamping, setStamping] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTimestamp, setEditTimestamp] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const parseTimestampField = (
    raw: string,
  ): { ok: true; timestamp?: string; startSeconds?: number } | { ok: false } => {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true };
    const normalized = normalizeOptionalTimestamp(trimmed);
    if (!normalized) return { ok: false };
    return {
      ok: true,
      timestamp: normalized.timestamp,
      startSeconds: normalized.startSeconds,
    };
  };

  const handleSubmitNew = (e?: FormEvent) => {
    e?.preventDefault();
    const cleaned = draftText.trim();
    if (!cleaned) return;

    const tsResult = parseTimestampField(draftTimestamp);
    if (!tsResult.ok) {
      setDraftError('Enter timestamp as mm:ss or h:mm:ss (e.g. 04:15).');
      return;
    }

    onAddNote(cleaned, tsResult.timestamp, tsResult.startSeconds);
    setDraftText('');
    setDraftTimestamp('');
    setDraftError(null);
  };

  const handleDraftKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmitNew();
    }
  };

  const handleStampCurrentTime = async () => {
    if (!onCaptureCurrentTime) return;
    setStamping(true);
    try {
      const result = await onCaptureCurrentTime();
      if (result) {
        setDraftTimestamp(result.timestamp);
        setDraftError(null);
      }
    } finally {
      setStamping(false);
    }
  };

  const startEdit = (note: UserNote) => {
    setEditingId(note.id);
    setEditText(note.text);
    setEditTimestamp(note.timestamp ?? '');
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setEditTimestamp('');
    setEditError(null);
  };

  const saveEdit = (id: string) => {
    const cleaned = editText.trim();
    if (!cleaned) return;

    const tsResult = parseTimestampField(editTimestamp);
    if (!tsResult.ok) {
      setEditError('Enter timestamp as mm:ss or h:mm:ss (e.g. 04:15).');
      return;
    }

    onUpdateNote(id, cleaned, tsResult.timestamp, tsResult.startSeconds);
    cancelEdit();
  };

  return (
    <section
      aria-labelledby="personal-notes-heading"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="personal-notes-heading"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-300"
        >
          <StickyNote className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          <span>My Personal Notes ({notes.length})</span>
        </h2>
      </div>

      {/* Add Personal Note Composer */}
      <form onSubmit={handleSubmitNew} className="space-y-2">
        <textarea
          rows={2}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={handleDraftKeyDown}
          placeholder="Add your own takeaway, question, or study reminder..."
          aria-label="Personal note text"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />

        <div
          className={`flex flex-wrap items-center gap-2 ${
            isYouTubeSource ? 'justify-between' : 'justify-end'
          }`}
        >
          {isYouTubeSource && (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                value={draftTimestamp}
                onChange={(e) => {
                  setDraftTimestamp(e.target.value);
                  if (draftError) setDraftError(null);
                }}
                placeholder="mm:ss (optional)"
                aria-label="Optional note timestamp"
                className="w-36 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              {onCaptureCurrentTime && (
                <button
                  type="button"
                  disabled={stamping}
                  onClick={() => void handleStampCurrentTime()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  title="Capture current YouTube playback time"
                >
                  <Clock className="h-3 w-3 text-indigo-500" aria-hidden="true" />
                  <span>{stamping ? 'Stamping...' : 'Use Video Time'}</span>
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={!draftText.trim()}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add Note</span>
          </button>
        </div>

        {draftError && (
          <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
            {draftError}
          </p>
        )}
      </form>

      {/* Saved Personal Notes List */}
      {notes.length === 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Your personal notes are saved locally with this lecture and included in Markdown exports.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => {
            const isEditing = editingId === note.id;

            if (isEditing) {
              return (
                <li
                  key={note.id}
                  className="space-y-2 rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-2.5"
                >
                  <textarea
                    rows={2}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    aria-label="Edit personal note text"
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <div
                    className={`flex flex-wrap items-center gap-2 ${
                      isYouTubeSource ? 'justify-between' : 'justify-end'
                    }`}
                  >
                    {isYouTubeSource && (
                      <input
                        type="text"
                        value={editTimestamp}
                        onChange={(e) => {
                          setEditTimestamp(e.target.value);
                          if (editError) setEditError(null);
                        }}
                        placeholder="mm:ss (optional)"
                        aria-label="Edit note timestamp"
                        className="w-36 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!editText.trim()}
                        onClick={() => saveEdit(note.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                      >
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Save
                      </button>
                    </div>
                  </div>
                  {editError && (
                    <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      {editError}
                    </p>
                  )}
                </li>
              );
            }

            return (
              <li
                key={note.id}
                className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/70"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-start gap-2">
                    {note.timestamp && note.startSeconds !== undefined &&
                      (isYouTubeSource ? (
                        <button
                          type="button"
                          onClick={() => onSeekVideo(note.startSeconds!)}
                          aria-label={`Jump to lecture timestamp ${note.timestamp}`}
                          className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 transition hover:bg-amber-500/25 dark:text-amber-300"
                          title={`Jump to ${note.timestamp}`}
                        >
                          <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                          {note.timestamp}
                        </button>
                      ) : (
                        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                          <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                          {note.timestamp}
                        </span>
                      ))}
                    <p className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-200">
                      {note.text}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(note)}
                    aria-label="Edit personal note"
                    title="Edit note"
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteNote(note.id)}
                    aria-label="Delete personal note"
                    title="Delete note"
                    className="rounded-md p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

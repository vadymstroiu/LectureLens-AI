import type { Flashcard, LectureSession } from '../types/lecture';

/**
 * Escapes a single CSV field per RFC 4180.
 */
export function escapeCsvField(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n');
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

/**
 * Generates an Anki-compatible `front,back` CSV string from flashcards.
 */
export function formatAnkiCsv(cards: Flashcard[]): string {
  const header = 'front,back';
  const rows = cards.map((card) => {
    const front = escapeCsvField(card.front.trim());
    const backWithTimestamp = card.timestamp
      ? `${card.back.trim()} [${card.timestamp}]`
      : card.back.trim();
    const back = escapeCsvField(backWithTimestamp);
    return `${front},${back}`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Generates formatted Markdown combining lecture metadata, timestamped takeaways,
 * key definitions, and active-recall flashcards.
 */
export function formatStudyMarkdown(session: LectureSession): string {
  const lines: string[] = [];
  lines.push(`# ${session.content.title || 'LectureLens AI Study Notes'}`);

  if (session.content.url) {
    lines.push(`Source: ${session.content.url}`);
  }
  lines.push('');

  if (session.notes) {
    if (session.notes.overview) {
      lines.push('## Overview');
      lines.push(session.notes.overview);
      lines.push('');
    }

    if (session.notes.takeaways.length > 0) {
      lines.push('## Key Takeaways');
      for (const item of session.notes.takeaways) {
        const ts = item.timestamp ? `[${item.timestamp}] ` : '';
        lines.push(`- ${ts}${item.point}`);
      }
      lines.push('');
    }

    if (session.notes.definitions.length > 0) {
      lines.push('## Key Definitions');
      for (const def of session.notes.definitions) {
        const ts = def.timestamp ? ` (${def.timestamp})` : '';
        lines.push(`- **${def.term}**${ts}: ${def.definition}`);
      }
      lines.push('');
    }
  }

  if (session.flashcards && session.flashcards.cards.length > 0) {
    lines.push('## Active-Recall Flashcards');
    session.flashcards.cards.forEach((card, index) => {
      const ts = card.timestamp ? ` [${card.timestamp}]` : '';
      lines.push(`${index + 1}. **Q:** ${card.front}`);
      lines.push(`   **A:** ${card.back}${ts}`);
    });
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * Triggers a client-side file download in the Side Panel document.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/csv;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

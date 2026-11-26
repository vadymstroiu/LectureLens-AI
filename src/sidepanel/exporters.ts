import { buildYouTubeTimestampUrl } from '../content/youtubeTranscriptParser';
import { summarizeTelemetry } from '../lib/hybridAi';
import type { LectureSession } from '../types/lecture';

function formatTimestampLink(
  timestamp: string | undefined,
  startSeconds: number | undefined,
  sourceUrl: string,
): string {
  const cleanTs = timestamp?.trim();
  if (!cleanTs) return '';

  if (sourceUrl) {
    const deepLink = buildYouTubeTimestampUrl(sourceUrl, startSeconds ?? 0);
    if (deepLink) {
      return `[${cleanTs}](${deepLink})`;
    }
  }

  // Non-YouTube sources (articles / pasted text) do not have a timeline at 00:00
  if (!startSeconds || startSeconds <= 0) {
    return '';
  }

  return `[${cleanTs}]`;
}

/**
 * Builds a clean, safe `.md` filename from the captured lecture title.
 */
export function buildMarkdownFilename(title: string): string {
  const slug = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `lecturelens-${slug || 'study-notes'}.md`;
}

/**
 * Formats a complete Markdown study guide containing lecture metadata,
 * overview, timestamped takeaways, definitions (+ Nano analogies), personal
 * user notes, flashcards with mastery status, and the full practice quiz.
 */
export function formatStudyMarkdown(session: LectureSession): string {
  const lines: string[] = [];
  const sourceUrl = session.content.url?.trim() ?? '';

  lines.push(`# ${session.content.title || 'LectureLens AI Study Notes'}`);
  lines.push('');

  if (sourceUrl) {
    lines.push(`- **Source:** [${sourceUrl}](${sourceUrl})`);
  }
  if (session.content.capturedAt > 0) {
    const iso = new Date(session.content.capturedAt)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
    lines.push(`- **Captured:** ${iso} UTC`);
  }
  if (session.telemetryHistory.length > 0) {
    const summary = summarizeTelemetry(session.telemetryHistory);
    lines.push(
      `- **Hybrid AI Telemetry:** ${summary.localCount} local (Gemini Nano), ${summary.cloudCount} cloud (${summary.onDevicePercent}% on-device)`,
    );
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
        const tsLink = formatTimestampLink(
          item.timestamp,
          item.startSeconds,
          sourceUrl,
        );
        lines.push(tsLink ? `- ${tsLink} ${item.point}` : `- ${item.point}`);
      }
      lines.push('');
    }

    if (session.notes.definitions.length > 0) {
      lines.push('## Key Definitions');
      for (const def of session.notes.definitions) {
        const tsLink = formatTimestampLink(
          def.timestamp,
          def.startSeconds,
          sourceUrl,
        );
        const tsPart = tsLink ? ` (${tsLink})` : '';
        lines.push(`- **${def.term}**${tsPart}: ${def.definition}`);

        const exp = session.explanations?.[`def:${def.term}`];
        if (exp) {
          lines.push(`  - *Analogy:* ${exp.analogy}`);
          lines.push(`  - *Key Idea:* ${exp.keyIdea}`);
        }
      }
      lines.push('');
    }
  }

  if (session.userNotes && session.userNotes.length > 0) {
    lines.push('## Personal Notes');
    for (const note of session.userNotes) {
      const tsLink = formatTimestampLink(
        note.timestamp,
        note.startSeconds,
        sourceUrl,
      );
      const body = note.text.trim().replace(/\n/g, '\n  ');
      lines.push(tsLink ? `- ${tsLink} ${body}` : `- ${body}`);
    }
    lines.push('');
  }

  if (session.flashcards && session.flashcards.cards.length > 0) {
    const cards = session.flashcards.cards;
    const masteredSet = new Set(session.masteredCardIds);
    const masteredCount = cards.filter((c) => masteredSet.has(c.id)).length;

    lines.push('## Active-Recall Flashcards');
    lines.push(`*${masteredCount} of ${cards.length} mastered*`);
    lines.push('');

    cards.forEach((card, index) => {
      const box = masteredSet.has(card.id) ? '[x]' : '[ ]';
      const tsLink = formatTimestampLink(
        card.timestamp,
        card.startSeconds,
        sourceUrl,
      );
      const tsSuffix = tsLink ? ` (${tsLink})` : '';
      lines.push(`${index + 1}. ${box} **Q:** ${card.front}`);
      lines.push(`   **A:** ${card.back}${tsSuffix}`);
    });
    lines.push('');
  }

  if (session.quiz && session.quiz.questions.length > 0) {
    const questions = session.quiz.questions;
    const answers = session.quizAnswers ?? {};
    const answeredCount = questions.filter(
      (q) => answers[q.id] !== undefined,
    ).length;
    const correctCount = questions.filter(
      (q) => answers[q.id] === q.correctIndex,
    ).length;

    lines.push('## Practice Quiz');
    if (answeredCount > 0) {
      lines.push(
        `*Score: ${correctCount} / ${questions.length} (${answeredCount} answered)*`,
      );
    }
    lines.push('');

    questions.forEach((q, idx) => {
      const tsLink = formatTimestampLink(
        q.timestamp,
        q.startSeconds,
        sourceUrl,
      );
      const tsSuffix = tsLink ? ` (${tsLink})` : '';
      lines.push(`### ${idx + 1}. ${q.question}${tsSuffix}`);

      const userChoice = answers[q.id];
      q.options.forEach((opt, optIdx) => {
        const letter = String.fromCharCode(65 + optIdx);
        const markers: string[] = [];
        if (optIdx === q.correctIndex) markers.push('**(Correct)**');
        if (userChoice === optIdx) markers.push('*(Your answer)*');
        const suffix = markers.length > 0 ? ` ${markers.join(' ')}` : '';
        lines.push(`- ${letter}. ${opt}${suffix}`);
      });

      const correctLetter = String.fromCharCode(65 + q.correctIndex);
      const correctOption = q.options[q.correctIndex] ?? '';
      lines.push(`> **Correct Answer:** ${correctLetter}. ${correctOption}`);
      if (q.explanation) {
        lines.push(`> **Explanation:** ${q.explanation}`);
      }
      const quizExp = session.explanations?.[`quiz:${q.id}`];
      if (quizExp) {
        lines.push(
          `> **Nano Analogy:** ${quizExp.analogy} — *Key Idea:* ${quizExp.keyIdea}`,
        );
      }
      lines.push('');
    });
  }

  return `${lines.join('\n').trim()}\n`;
}

/**
 * Triggers a client-side file download in the Side Panel document.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/markdown;charset=utf-8',
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

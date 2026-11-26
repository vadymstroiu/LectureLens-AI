/**
 * Measurements for ranking `<video>` elements on a YouTube page so the active
 * main watch player is always selected ahead of inline hover previews or
 * hidden miniplayer elements.
 */
export interface VideoCandidateMetrics {
  isMainWatchPlayer: boolean;
  isInlinePreview: boolean;
  width: number;
  height: number;
  duration: number;
  currentTime: number;
  readyState: number;
  paused: boolean;
}

/**
 * Scores candidate `<video>` descriptors and returns the index of the best
 * primary watch player, or `-1` when `candidates` is empty.
 */
export function selectPrimaryVideoIndex(
  candidates: VideoCandidateMetrics[],
): number {
  if (candidates.length === 0) return -1;

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let score = 0;

    if (c.isInlinePreview) score -= 1000;
    if (c.width < 20 || c.height < 20) score -= 500;
    if (c.isMainWatchPlayer) score += 400;
    if (Number.isFinite(c.duration) && c.duration > 0) score += 300;
    if (c.readyState >= 1) score += 150;
    if (!c.paused) score += 120;
    if (c.currentTime > 0) score += 80;
    score += Math.min(100, Math.max(0, (c.width * c.height) / 10000));

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Finds the active main YouTube `<video>` element in `doc`, ignoring hidden or
 * inline hover preview players.
 */
export function findPrimaryYouTubeVideo(
  doc: Document = document,
): HTMLVideoElement | null {
  const videos = Array.from(doc.querySelectorAll<HTMLVideoElement>('video'));
  if (videos.length === 0) return null;

  const metrics: VideoCandidateMetrics[] = videos.map((video) => {
    const rect = video.getBoundingClientRect();
    const isInlinePreview = Boolean(
      video.closest('#inline-preview-player, ytd-video-preview'),
    );
    const isMainWatchPlayer = Boolean(
      !isInlinePreview &&
        (video.closest('#movie_player, ytd-player#ytd-player') ||
          video.classList.contains('html5-main-video') ||
          video.classList.contains('video-stream')),
    );

    return {
      isMainWatchPlayer,
      isInlinePreview,
      width: rect.width,
      height: rect.height,
      duration: video.duration,
      currentTime: video.currentTime,
      readyState: video.readyState,
      paused: video.paused,
    };
  });

  const bestIdx = selectPrimaryVideoIndex(metrics);
  return bestIdx >= 0 ? videos[bestIdx] : null;
}

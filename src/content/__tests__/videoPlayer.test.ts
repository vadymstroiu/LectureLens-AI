import { describe, expect, it } from 'vitest';
import { selectPrimaryVideoIndex } from '../videoPlayer';

describe('selectPrimaryVideoIndex', () => {
  it('returns -1 when no video elements exist', () => {
    expect(selectPrimaryVideoIndex([])).toBe(-1);
  });

  it('picks the main watch player at 12:34 ahead of an earlier inline preview at 00:00', () => {
    const idx = selectPrimaryVideoIndex([
      {
        isMainWatchPlayer: false,
        isInlinePreview: true,
        width: 360,
        height: 202,
        duration: 0,
        currentTime: 0,
        readyState: 0,
        paused: true,
      },
      {
        isMainWatchPlayer: true,
        isInlinePreview: false,
        width: 1280,
        height: 720,
        duration: 2340,
        currentTime: 754,
        readyState: 4,
        paused: false,
      },
    ]);

    expect(idx).toBe(1);
  });

  it('prefers a loaded visible video over a hidden 0x0 miniplayer element', () => {
    const idx = selectPrimaryVideoIndex([
      {
        isMainWatchPlayer: false,
        isInlinePreview: false,
        width: 0,
        height: 0,
        duration: Number.NaN,
        currentTime: 0,
        readyState: 0,
        paused: true,
      },
      {
        isMainWatchPlayer: false,
        isInlinePreview: false,
        width: 854,
        height: 480,
        duration: 900,
        currentTime: 120,
        readyState: 4,
        paused: true,
      },
    ]);

    expect(idx).toBe(1);
  });
});

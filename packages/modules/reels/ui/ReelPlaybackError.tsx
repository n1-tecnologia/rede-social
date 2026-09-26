import { CircleAlert } from 'lucide-react';

export interface ReelPlaybackErrorProps {
  /** The catalog's "one video will not play" sentence (`reels.errors.playback`). */
  message: string;
  /** The retry pill's name (`reels.errors.retry`). */
  retryLabel: string;
  /** The host mints a fresh playback token and remounts the video. */
  onRetry: () => void;
}

/**
 * UI-D-93b — the block a page shows when its video will not play (a failed token mint, a player
 * error, a `failed` asset reached through a race). No raw player or provider error ever reaches it
 * (T-03-51): the copy is the host's catalog sentence.
 *
 * **It is a SIZED block, never a full-cover absolute sibling.** A full-cover container would swallow
 * every pointer on the page, so the viewer could no longer swipe past the broken video, and the rail
 * and caption under it would go dead — the story viewer's shipped rule. The host centres it on the
 * page; it takes pointer events on itself only, and the 14 px line wraps inside 16 px side insets
 * (it is never truncated), while the pill stays on one line at 320 px.
 */
export function ReelPlaybackError({ message, retryLabel, onRetry }: ReelPlaybackErrorProps) {
  return (
    <div className="pointer-events-auto mx-4 flex flex-col items-center gap-2 text-center">
      <CircleAlert size={24} aria-hidden className="text-white/70" />
      <p className="text-sm text-white">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-11 items-center whitespace-nowrap rounded-full bg-black/35 px-4 font-bold text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {retryLabel}
      </button>
    </div>
  );
}

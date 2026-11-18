/**
 * The one-at-a-time rule of the voice players (UI-D-849, UI-D-851, A-UI-11), module-scoped on purpose:
 * every player on the page registers one `pause` callback, starting any player pauses all the others
 * (each keeps its own position: this controller never resets anything), and the host calls
 * `pauseAllVoice()` when a recording starts so the speaker never feeds the microphone (UI-D-845).
 *
 * No kernel import, no storage, no event is written anywhere: pausing is the only thing it does, and a
 * player that is not playing treats the call as a no-op (D-855: nothing records that a message played).
 */

type Pause = () => void;

const players = new Map<string, Pause>();

export const playbackController = {
  /** Add a player; the returned function removes it (the same as `release`). */
  register(id: string, pause: Pause): () => void {
    players.set(id, pause);
    return () => playbackController.release(id);
  },
  /** `id` is about to play: every other registered player pauses and keeps its position. */
  activate(id: string): void {
    for (const [other, pause] of [...players]) {
      if (other !== id) pause();
    }
  },
  /** A player left (unmounted): it is pausing itself, and the controller forgets it. */
  release(id: string): void {
    players.delete(id);
  },
};

/** Pause every voice player on the page (a recording is starting). Positions are kept. */
export function pauseAllVoice(): void {
  for (const pause of [...players.values()]) pause();
}

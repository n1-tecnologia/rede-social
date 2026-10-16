'use client';

import { Button } from '@rede-social/ui';
import { Play } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { LessonPlayer } from '@/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonPlayer';
import { LessonSessionProvider } from '@/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonSession';
import type { VideoPlayerStatus } from '@/components/media/VideoPlayer';

/**
 * The live page's replay (08.5-09, UI-D-435, A-UI-7, D-433): "Assistir ao replay" swaps the cover
 * box for the shipped player of the replay lesson, through the plan-08 wiring.
 *
 *  - **One mint per tap** (A-UI-7): the `VideoPlayer` mounts — and so asks for its playback token —
 *    only after the tap; a page view mints nothing.
 *  - **The swap is in place**: the player frame sits in a box of the cover's own 16:10 size, so the
 *    page below does not move (E10 loading). A mint failure shows the shipped player error inside
 *    that box (E10 error); the box only grows when the player's own retry needs the room.
 *  - **Playback starts and focus follows**: focus moves to the player box at once (the button that
 *    held it leaves), then to the `<mux-player>` once it upgrades, which is asked to `play()`.
 *  - **Progress** (D-427, D-430): `LessonPlayer` resumes at the replay lesson's
 *    `lastPositionSeconds` and writes through the 15-second reporter and the pagehide beacon, for
 *    `replay.lessonId`. There is no completion button on this page; a server-decided ≥ 90% completes
 *    the lesson as on the player. A lock or removal answer stops the writes (UI-D-433).
 *  - "Materiais da gravação" (`MemberMaterials`) shares this session, so a lock seen on a material
 *    tap stops the player too.
 */

interface ReplayState {
  playing: boolean;
  play: () => void;
}

const ReplayContext = createContext<ReplayState | null>(null);

function useReplay(): ReplayState {
  const value = useContext(ReplayContext);
  if (!value) throw new Error('useReplay outside LiveReplayProvider');
  return value;
}

export interface LiveReplayProviderProps {
  /** The live page's own URL: where a removed replay lesson sends the member (a fresh read). */
  liveHref: string;
  /** The replay lesson's stored completion (the server's). */
  completed: boolean;
  children: ReactNode;
}

/** Wraps the live page's body in the replay's state and the replay lesson's session. */
export function LiveReplayProvider({ liveHref, completed, children }: LiveReplayProviderProps) {
  const [playing, setPlaying] = useState(false);
  return (
    <LessonSessionProvider courseHref={liveHref} initialCompleted={completed}>
      <ReplayContext.Provider value={{ playing, play: () => setPlaying(true) }}>
        {children}
      </ReplayContext.Provider>
    </LessonSessionProvider>
  );
}

export interface LiveReplayMediaProps {
  /** The server-rendered cover box (16:10, pills): shown until the tap. */
  cover: ReactNode;
  lessonId: string;
  video: { assetId: string; status: VideoPlayerStatus; startTime: number };
}

/** How often, and for how long, the swap waits for `<mux-player>` to upgrade before playing it. */
const PLAYER_PROBE_STEP_MS = 120;
const PLAYER_PROBE_TIMEOUT_MS = 6000;

/** The cover box until the tap; the replay player in a box of the same size after it. */
export function LiveReplayMedia({ cover, lessonId, video }: LiveReplayMediaProps) {
  const { playing } = useReplay();
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!playing) return;
    boxRef.current?.focus();
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += PLAYER_PROBE_STEP_MS;
      const element = boxRef.current?.querySelector('mux-player') as
        | (HTMLElement & { play?: () => Promise<void> | undefined })
        | null;
      if (element) {
        clearInterval(timer);
        element.focus();
        try {
          void element.play?.()?.catch(() => {
            // The browser refused autoplay: the player's own play control stays one tap away.
          });
        } catch {
          // Same: an element without a working `play` keeps its own controls.
        }
        return;
      }
      if (elapsed >= PLAYER_PROBE_TIMEOUT_MS) clearInterval(timer);
    }, PLAYER_PROBE_STEP_MS);
    return () => clearInterval(timer);
  }, [playing]);

  if (!playing) return <>{cover}</>;

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      data-testid="live-replay-player"
      className="flex aspect-[16/10] w-full flex-col justify-center bg-black focus-visible:outline-none"
    >
      <LessonPlayer
        lessonId={lessonId}
        assetId={video.assetId}
        status={video.status}
        startTime={video.startTime}
        writes
      />
    </div>
  );
}

/** "Assistir ao replay" (brand, `Play` 18): leaves once tapped. */
export function LiveReplayButton({ label }: { label: string }) {
  const { playing, play } = useReplay();
  if (playing) return null;
  return (
    <Button
      type="button"
      variant="brand"
      size="md"
      fullWidth
      className="gap-2"
      data-testid="live-replay-button"
      onClick={play}
    >
      <Play aria-hidden size={18} />
      {label}
    </Button>
  );
}

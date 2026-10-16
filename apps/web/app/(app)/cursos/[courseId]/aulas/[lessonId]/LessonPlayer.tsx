'use client';

import { useEffect, useRef } from 'react';
import { saveProgressAction } from '@/app/(app)/cursos/learn-actions';
import { VideoPlayer, type VideoPlayerStatus } from '@/components/media/VideoPlayer';
import { createProgressReporter, type ProgressReporter } from '@/lib/progress-reporter';
import { useLessonSession } from './LessonSession';

/**
 * The member player's media block (08.5-08, UI-D-432, UI-D-433, D-427, D-430, R-Pattern 6): the
 * shipped `VideoPlayer` full-bleed (`bleed`), resumed at the member's stored place (`startTime`, no
 * "Continuar de mm:ss" prompt), with its processing and failed states untouched.
 *
 * **Writes** (only when `writes` — never in the admin's preview, D-422, UI-D-437: the player then
 * gets NO `onProgress` and no beacon listener, so nothing can be sent):
 *  - the element's events go through the pure 15-second throttle (`createProgressReporter`): at most
 *    one tick every 15 s while playing, plus one write on pause and one on end;
 *  - each write is `saveProgressAction` — silent (UI-D-433): no spinner, toast or saved indicator; a
 *    failed tick is dropped and the next one writes the latest place;
 *  - an answer with a newly set `completedAt` (the server's ≥ 90%) completes the session — the zone
 *    swaps, "Aula concluída." is announced, the page refreshes the locks, the video keeps playing;
 *  - a lock or removal answer stops the session (pause, toast, refresh or navigate);
 *  - on `pagehide` the last position seen leaves through `navigator.sendBeacon('/api/courses/progress')`
 *    (or a `keepalive` fetch), because a server action is aborted on unload. The beacon carries only
 *    `{ lessonId, positionSeconds }`: it never completes a lesson by itself.
 *
 * The SERVER decides completion and clamps the position to its own duration (R-Pitfall 10).
 */
export interface LessonPlayerProps {
  lessonId: string;
  assetId: string;
  status: VideoPlayerStatus;
  /** The stored `lastPositionSeconds` (D-430). */
  startTime: number;
  /** False in the admin's preview: no write of any kind. */
  writes: boolean;
}

const BEACON_URL = '/api/courses/progress';

export function LessonPlayer({ lessonId, assetId, status, startTime, writes }: LessonPlayerProps) {
  const session = useLessonSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const reporterRef = useRef<ProgressReporter | null>(null);
  if (writes && reporterRef.current === null) {
    reporterRef.current = createProgressReporter({
      now: () => Date.now(),
      send: (positionSeconds) => {
        if (sessionRef.current.stopped()) return;
        saveProgressAction(lessonId, positionSeconds)
          .then((result) => {
            if (!result.ok) {
              // A generic failure is a dropped tick (UI-D-433); a lock or removal stops the session.
              sessionRef.current.refuse(result.code);
              return;
            }
            if (result.completedAt !== null) sessionRef.current.markCompleted();
          })
          .catch(() => {
            // A transport failure is a dropped tick too: the next event writes the latest place.
          });
      },
    });
  }

  useEffect(() => {
    if (!writes) return;
    const onPageHide = () => {
      const position = reporterRef.current?.lastPosition() ?? null;
      if (position === null || sessionRef.current.stopped()) return;
      const body = JSON.stringify({ lessonId, positionSeconds: position });
      try {
        if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(BEACON_URL, body)) {
          return;
        }
        void fetch(BEACON_URL, {
          method: 'POST',
          body,
          keepalive: true,
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
        }).catch(() => {});
      } catch {
        // The page is going away: nothing to tell anyone.
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [lessonId, writes]);

  return (
    <div data-testid="lesson-player" data-writes={writes ? 'on' : 'off'}>
      <VideoPlayer
        assetId={assetId}
        status={status}
        bleed
        startTime={startTime}
        onProgress={
          writes
            ? (positionSeconds, _durationSeconds, reason) =>
                reporterRef.current?.onProgress(positionSeconds, reason)
            : undefined
        }
      />
    </div>
  );
}

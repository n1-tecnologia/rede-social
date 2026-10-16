'use client';

import { useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LessonRefusalCode } from '@/app/(app)/cursos/learn-actions';

/**
 * The open lesson's shared client state (08.5-08, UI-D-432, UI-D-433): the ONE place the player, the
 * completion zone, the materials and the previous/next pair agree on two facts.
 *
 * **Completion.** It starts from the server's stored `completedAt` and flips ONCE, one-way (D-427),
 * when the server answers a newly set `completedAt` — to the button, or to a tick at ≥ 90% from the
 * player. The flip swaps the zone to the done block instantly, toasts "Aula concluída." (the toast is
 * `role="status"`, the announcement) and `router.refresh()`es so the module list and "Próxima aula"
 * unlock from the server's answer; the playing video is not interrupted (it is a client island the
 * refresh keeps).
 *
 * **Refusals mid-session.** A `403 lesson_locked` or `409 lesson_sequence_locked` to a tick, the
 * button or a material URL pauses playback, toasts "Esta aula agora é exclusiva…" / "Esta aula ficou
 * bloqueada…" and refreshes, which lands on the lock page (UI-D-431); a removed lesson toasts "Esta
 * aula não está mais disponível." and navigates to the course. After any of those the session is
 * STOPPED: no further tick or beacon is sent for a lesson the server refused.
 *
 * The host keys this provider by the lesson id, so moving to another lesson starts a fresh session.
 */
export interface LessonSessionValue {
  completed: boolean;
  /** The server answered a set `completedAt`: swap, toast and refresh, once. */
  markCompleted: (options?: { focusDone?: boolean }) => void;
  /** Whether the done block should take focus (the button was the focused control). */
  consumeFocusRequest: () => boolean;
  /** A lock, removal or generic code → the UI-D-433 reaction; `false` when the caller handles it. */
  refuse: (code: LessonRefusalCode) => boolean;
  /** True once a refusal stopped the session: writes are no longer sent. */
  stopped: () => boolean;
}

const LessonSessionContext = createContext<LessonSessionValue | null>(null);

export function useLessonSession(): LessonSessionValue {
  const value = useContext(LessonSessionContext);
  if (!value) throw new Error('useLessonSession outside LessonSessionProvider');
  return value;
}

/** Every `<mux-player>` on the page stops: a refused lesson does not keep playing (UI-D-433). */
function pausePlayback() {
  for (const element of document.querySelectorAll('mux-player')) {
    (element as unknown as { pause?: () => void }).pause?.();
  }
}

export interface LessonSessionProviderProps {
  /** The course page (`?ver=aluno` kept in preview): where a removed lesson sends the member. */
  courseHref: string;
  /** The server's stored completion. */
  initialCompleted: boolean;
  children: ReactNode;
}

export function LessonSessionProvider({
  courseHref,
  initialCompleted,
  children,
}: LessonSessionProviderProps) {
  const t = useTranslations('courses.member.player');
  const toast = useToast();
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);
  const completedRef = useRef(initialCompleted);
  const focusRequest = useRef(false);
  const stoppedRef = useRef(false);

  const markCompleted = useCallback(
    (options?: { focusDone?: boolean }) => {
      if (completedRef.current) return;
      completedRef.current = true;
      focusRequest.current = options?.focusDone === true;
      setCompleted(true);
      toast.show({ tone: 'success', message: t('doneToast') });
      router.refresh();
    },
    [router, t, toast],
  );

  const consumeFocusRequest = useCallback(() => {
    const requested = focusRequest.current;
    focusRequest.current = false;
    return requested;
  }, []);

  const refuse = useCallback(
    (code: LessonRefusalCode) => {
      if (code === 'generic') return false;
      if (stoppedRef.current) return true;
      stoppedRef.current = true;
      pausePlayback();
      if (code === 'gone') {
        toast.show({ tone: 'error', message: t('errors.gone') });
        router.push(courseHref);
        return true;
      }
      toast.show({
        tone: 'error',
        message: t(code === 'lesson_locked' ? 'errors.lockedNow' : 'errors.sequenceNow'),
      });
      router.refresh();
      return true;
    },
    [courseHref, router, t, toast],
  );

  const stopped = useCallback(() => stoppedRef.current, []);

  const value = useMemo(
    () => ({ completed, markCompleted, consumeFocusRequest, refuse, stopped }),
    [completed, markCompleted, consumeFocusRequest, refuse, stopped],
  );
  return <LessonSessionContext.Provider value={value}>{children}</LessonSessionContext.Provider>;
}

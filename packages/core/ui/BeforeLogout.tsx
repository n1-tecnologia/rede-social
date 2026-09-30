'use client';

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
} from 'react';

/** A host cleanup that must run before the sign-out action (07-07: forget this device's push). */
export type BeforeLogout = () => Promise<unknown>;

/** A cleanup never holds logout longer than this (T-07-48). */
export const BEFORE_LOGOUT_TIMEOUT_MS = 2000;

const BeforeLogoutContext = createContext<BeforeLogout | null>(null);

/**
 * The kernel seam that lets a kernel-owned logout form (the desktop rail's "Sair") await a
 * host-provided cleanup without the kernel knowing what it is (planning decision 2). The web's
 * `LiveShell` provides `disablePush` for the tenant shell; with no provider the hook returns null
 * and logout proceeds at once.
 */
export function BeforeLogoutProvider({
  value,
  children,
}: {
  value: BeforeLogout | null;
  children: ReactNode;
}) {
  return <BeforeLogoutContext.Provider value={value}>{children}</BeforeLogoutContext.Provider>;
}

export function useBeforeLogout(): BeforeLogout | null {
  return useContext(BeforeLogoutContext);
}

/**
 * Runs `cleanup` (when present) and settles after it finishes or after `timeoutMs`, whichever comes
 * first. Never rejects: a failed or hanging cleanup must never keep a member signed in.
 */
export async function runBeforeLogout(
  cleanup: BeforeLogout | null | undefined,
  timeoutMs = BEFORE_LOGOUT_TIMEOUT_MS,
): Promise<void> {
  if (!cleanup) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(cleanup)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A logout `<form onSubmit>` that runs `cleanup` first: the first submit is prevented, the cleanup
 * runs (bounded), then the form is re-submitted ONCE with `requestSubmit()`, which this handler lets
 * through so React runs the form's server action. A ref guards the re-entry, and a second tap while
 * the cleanup runs is ignored. With no cleanup the submit is untouched.
 */
export function useLogoutSubmit(
  cleanup: BeforeLogout | null | undefined,
): (event: FormEvent<HTMLFormElement>) => void {
  const pass = useRef(false);
  const running = useRef(false);
  return useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (pass.current) {
        pass.current = false;
        return;
      }
      if (!cleanup) return;
      event.preventDefault();
      if (running.current) return;
      running.current = true;
      const form = event.currentTarget;
      void runBeforeLogout(cleanup).then(() => {
        running.current = false;
        pass.current = true;
        form.requestSubmit();
      });
    },
    [cleanup],
  );
}

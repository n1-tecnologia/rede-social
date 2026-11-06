'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * A block of questions opening and closing in place (12.2-14, D-641, D-644, D-645; UI-D-679). It replaces the
 * per-question reveal of 12.1.
 *
 * It wraps the consecutive questions of ONE branch in a single wrapper with one shared left rail
 * (the neutral border and the small left padding of the UI-SPEC), so the group reads as a group and appears and leaves as
 * a unit with a 200ms opacity and height reveal; under `prefers-reduced-motion` it is instant. A nested branch
 * is another wrapper INSIDE this one, so the rails nest. The rail stays on the block even when a question
 * inside it is flagged: several questions share one rail.
 *
 * `AnimatePresence initial={false}` means the first render never animates: a block that is open when the member
 * arrives at its step (its opener sits in another step) is simply there. **It never moves focus**: revealing a
 * block under someone who is still choosing would be a WCAG 3.2.2 failure, and the next Tab stop after the
 * opener is the first revealed control. The wrapper is a plain `div` with no landmark; the announcement is the
 * form's single polite live region, not this wrapper's.
 */

export interface RevealedBranchProps {
  /** Whether any question inside the block is visible under the current drafts. */
  show: boolean;
  children: ReactNode;
}

export function RevealedBranch({ show, children }: RevealedBranchProps) {
  const reduced = useReducedMotion();
  const body = (
    <div data-revealed-branch className="flex flex-col gap-6 border-l-2 border-border pl-3">
      {children}
    </div>
  );

  if (reduced) return show ? body : null;

  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="revealed"
          initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
          animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
          exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {body}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

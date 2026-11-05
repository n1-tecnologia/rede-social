'use client';

import { cn } from '@rede-social/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * A conditional question opening and closing in place (12.1-14, D-621; UI-D-655, UI-D-660).
 *
 * It wraps the question at its own position in the step. When the opener is answered the question appears with
 * a 200ms opacity and height reveal; under `prefers-reduced-motion` it appears and leaves instantly. It wears
 * the neutral left rule so the member reads it as a follow-up (a flagged one drops the rule: the danger block
 * of the question is the signal). **It never moves focus**: revealing a question under someone who is still
 * choosing, for example ticking a second option, would be a WCAG 3.2.2 failure, and the next Tab stop after the
 * opener is the revealed control. The announcement is the form's single polite live region, not this wrapper's.
 */

export interface RevealedFieldProps {
  /** Whether the question is visible under the current drafts. */
  show: boolean;
  /** A flagged question has the danger block instead of the neutral rule. */
  flagged: boolean;
  children: ReactNode;
}

export function RevealedField({ show, flagged, children }: RevealedFieldProps) {
  const reduced = useReducedMotion();
  const body = (
    <div data-revealed className={cn(!flagged && 'border-l-2 border-border pl-3')}>
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

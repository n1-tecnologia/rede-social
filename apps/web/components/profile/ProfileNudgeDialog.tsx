'use client';

import { Button, cn, useFocusTrap } from '@rede-social/ui';
import { UserPen } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useRef } from 'react';

export interface ProfileNudgeDialogProps {
  open: boolean;
  /** "Completar agora": the host ends the popup for the visit and opens the profile editor. */
  onComplete: () => void;
  /** "Mais tarde", and Escape: the host ends the popup for the visit. */
  onLater: () => void;
  /**
   * The wizard preview's copy (`TenantAppPreview`): the same popup, `absolute` over the phone's app
   * root instead of `fixed`, marked `data-preview-nudge`, and with NO dialog semantics, focus trap
   * or initial focus. The phone is `aria-hidden` and kept out of the tab order by design, and it
   * stays mounted (hidden below `xl`) while the admin fills the form beside it: a trap there would
   * take the focus, and the page's own Tab and Escape keys, away from that form. A keyboard gets it
   * off the phone through the panel's screen picker instead (`usePreviewNudge`).
   */
  preview?: boolean;
}

/** The reference's card spring (`socialroberth-completo`, `ConviteCompletarPerfil`). */
const CARD_SPRING = { type: 'spring', stiffness: 320, damping: 26 } as const;

/**
 * The D-02 profile nudge as the "Complete seu perfil" POPUP. A product decision of 2026-10-02
 * amends D-02's "a card, never a modal": the inline card at the top of `/inicio` became this
 * centred card over a dimmed, lightly blurred page, ported from the reference app
 * (`socialroberth-completo`, `components/profile/ConviteCompletarPerfil.tsx`): the 56px disc with
 * the pen-on-person icon, the title, one line of body and two full-width answers, "Completar agora"
 * over "Mais tarde".
 *
 * **Two answers and nothing else.** No X glyph and no backdrop tap: a tap beside the card is not an
 * answer, as in the reference. Escape is "Mais tarde". Focus starts on "Completar agora": it is the
 * card's first control, which is where `useFocusTrap` lands without an `initialFocus` (that
 * parameter is for a target outside the Tab ring, and the `Button` primitive takes no ref), and
 * Tab / Shift+Tab cycle between the two answers.
 *
 * **Stateless.** The host decides when it is open and what each answer does:
 * `ProfileNudgeOnArrival` on Início, `TenantAppPreview` in the wizard's phone. The copy is the
 * catalog's `profile.nudge`.
 *
 * On the overlay rung of tokens.css' ladder (z-[55], with `BottomSheet` and `ConfirmDialog`) and
 * rendered INLINE, never portaled: the tenant's `--brand-*` live on `[data-brand-root]`, and the
 * `aria-modal` is what makes tokens.css hide the BottomNav while it is open. Motion: the overlay
 * fades and the card springs up from 94%; under reduced motion the card only fades.
 */
export function ProfileNudgeDialog({
  open,
  onComplete,
  onLater,
  preview = false,
}: ProfileNudgeDialogProps) {
  const t = useTranslations('profile');
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  useFocusTrap(panelRef, open && !preview, onLater);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="profile-nudge"
          data-preview-nudge={preview ? '' : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'inset-0 z-[55] flex items-center justify-center px-6',
            preview ? 'absolute' : 'fixed',
          )}
        >
          <div aria-hidden className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
          <motion.div
            ref={panelRef}
            role={preview ? undefined : 'dialog'}
            aria-modal={preview ? undefined : true}
            aria-labelledby={preview ? undefined : titleId}
            aria-describedby={preview ? undefined : bodyId}
            tabIndex={preview ? undefined : -1}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={reduceMotion ? { duration: 0.2 } : CARD_SPRING}
            className="relative w-full max-w-[400px] rounded-2xl bg-bg-secondary p-6 text-center shadow-2xl outline-none"
          >
            <span
              aria-hidden
              className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand/12 text-brand"
            >
              <UserPen size={24} />
            </span>
            <h2 id={titleId} className="mt-4 text-lg font-bold leading-tight text-text">
              {t('nudge.title')}
            </h2>
            <p id={bodyId} className="mt-2 text-sm leading-relaxed text-text-secondary">
              {t('nudge.body')}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="brand" fullWidth onClick={onComplete}>
                {t('nudge.action')}
              </Button>
              <Button variant="outline" fullWidth onClick={onLater}>
                {t('nudge.dismiss')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

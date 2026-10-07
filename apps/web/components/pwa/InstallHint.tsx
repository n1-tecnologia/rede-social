'use client';

import { BottomSheet, Button } from '@rede-social/ui';
import { Share } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

/**
 * iOS "Adicione à Tela de Início" coach mark (D-33 [designed] screen `install-hint`, UI-SPEC
 * §PWA + E20). It is never mounted globally: Phase 7 mounts it FROM THE PUSH FLOW only
 * (`components/push/PushControls.tsx`), as `variant="push"`, when an iPhone or iPad outside the Home
 * Screen app taps "Ativar" (D-234, UI-D-257; CLAUDE.md PWA §1 — iOS only delivers Web Push to
 * Home-Screen installs). The Android install-prompt event is captured by `lib/install-prompt.ts`
 * for the install gate (`InstallGate.tsx`); this sheet still only serves the push flow.
 *
 * `variant="push"` (UI-D-257) keeps the sheet geometry, carries the push copy
 * (`pwa.install.push.*`), shows ONE full-width "Entendi" and no "Agora não", and writes NO 14-day
 * dismissal: the sheet answers the member's tap, it is not a nag. It is controlled by `open`, and
 * "Entendi", Escape, the backdrop and a drag-down all call `onClose`.
 *
 * Behaviour: "Entendi" closes without persisting; "Agora não" writes `rede_install_hint_dismissed`
 * (= now, ms) to localStorage and the sheet stays hidden for 14 days; Escape / backdrop / drag-down
 * behave like "Entendi". The dismissal is a UX preference only (T-02-78): `Number()` + NaN check
 * means garbage in storage reads as "not dismissed" and it is never used for authorisation.
 *
 * The pure helpers are exported for Phase 7 and pinned by InstallHint.test.ts.
 */

export const INSTALL_HINT_DISMISSED_KEY = 'rede_install_hint_dismissed';
export const INSTALL_HINT_DISMISS_MS = 14 * 24 * 3600 * 1000;

const STANDALONE_QUERY = '(display-mode: standalone)';

/** iOS Safari only: the copy describes Safari's Share menu (Chrome/Firefox/Edge on iOS differ). */
export function isIosSafari(userAgent: string): boolean {
  if (!/iPad|iPhone|iPod/.test(userAgent)) return false;
  if (/MSStream/.test(userAgent)) return false;
  return !/CriOS\/|FxiOS\/|EdgiOS\//.test(userAgent);
}

export type WindowLike = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
};

/** Installed (standalone) detection: the media query, or the legacy iOS `navigator.standalone`. */
export function isStandalone(w: WindowLike): boolean {
  if (w.matchMedia?.(STANDALONE_QUERY).matches) return true;
  return w.navigator?.standalone === true;
}

export function shouldShowInstallHint({
  userAgent,
  standalone,
  dismissedAt,
  now,
}: {
  userAgent: string;
  standalone: boolean;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (!isIosSafari(userAgent)) return false;
  if (standalone) return false;
  if (dismissedAt === null || Number.isNaN(dismissedAt)) return true;
  return now - dismissedAt > INSTALL_HINT_DISMISS_MS;
}

function readDismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

export type InstallHintVariant = 'install' | 'push';

export function InstallHint({
  open,
  variant = 'install',
  onClose,
}: {
  open?: boolean;
  variant?: InstallHintVariant;
  onClose?: () => void;
} = {}) {
  const t = useTranslations('pwa');
  const push = variant === 'push';
  // Closed until the effect runs: the decision needs the UA, matchMedia and localStorage, none of
  // which exist on the server (never rendered in the first HTML).
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open !== undefined) {
      setVisible(open);
      return;
    }
    setVisible(
      shouldShowInstallHint({
        userAgent: window.navigator.userAgent,
        standalone: isStandalone(window as WindowLike),
        dismissedAt: readDismissedAt(),
        now: Date.now(),
      }),
    );
  }, [open]);

  const close = useCallback(() => {
    setVisible(false);
    onClose?.();
  }, [onClose]);
  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage unavailable (private mode quota): the sheet simply closes for this session.
    }
    setVisible(false);
    onClose?.();
  }, [onClose]);

  return (
    <BottomSheet open={visible} onClose={close}>
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Share aria-hidden size={28} />
        </div>
        <h2 className="text-base font-bold leading-tight text-text">
          {push ? t('install.push.title') : t('install.title')}
        </h2>
        <p className="text-sm leading-relaxed text-text-secondary">
          {push ? t('install.push.body') : t('install.body')}
          <Share aria-hidden size={16} className="ml-1 inline-block align-text-bottom" />
        </p>
        <div className="flex w-full flex-col gap-2 pt-2">
          <Button variant="brand" fullWidth onClick={close} data-install-hint-confirm={variant}>
            {push ? t('install.push.confirm') : t('install.confirm')}
          </Button>
          {push ? null : (
            <Button variant="ghost" fullWidth onClick={dismiss}>
              {t('install.dismiss')}
            </Button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

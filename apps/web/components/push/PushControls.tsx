'use client';

import { PushSwitchRow, SoftAskCard } from '@rede-social/module-notifications/ui';
import { useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InstallHint } from '@/components/pwa/InstallHint';
import {
  disablePush,
  enablePush,
  type PushRegistrationLike,
  type PushState,
  type PushWindowLike,
  pushRegistration,
  pushSupport,
  readPushState,
  readSoftAskDismissed,
  writeSoftAskDismissed,
} from '@/lib/push';

/**
 * The web composition of the two push entry points (D-233, UI-D-255/256/257): the soft-ask card on
 * `/notificacoes` and the Configurações switch row. Both run the ONE flow in `lib/push.ts`.
 *
 * - **Decided after mount.** The server renders the row in `checking` and renders no card; the real
 *   state needs `window`, `Notification` and the service worker.
 * - **The registration is obtained on mount, BEFORE any tap** (RESEARCH Pitfall 6), and the VAPID key
 *   arrives as a prop, so the tap handler's first await is the permission prompt (`enablePush`).
 * - **iOS/iPadOS outside the Home Screen app** never prompts: the tap opens `InstallHint
 *   variant="push"` (D-234).
 * - **No prompt from an effect, ever** (D-233): `enablePush` is only called from the two tap handlers.
 */

type SettledState = Exclude<PushState, 'checking'>;

function currentWindow(): PushWindowLike {
  return window as unknown as PushWindowLike;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** This device's push state and its service worker registration, read after mount. */
function usePushDevice(vapidKey: string | null) {
  const [state, setState] = useState<PushState>('checking');
  const [registration, setRegistration] = useState<PushRegistrationLike | null>(null);

  useEffect(() => {
    let alive = true;
    const win = currentWindow();
    const support = pushSupport(win, vapidKey);
    if (support !== 'available') {
      setState(support);
      return;
    }
    if (win.Notification?.permission === 'denied') {
      setState('denied');
      return;
    }
    void pushRegistration().then(async (reg) => {
      if (!alive) return;
      setRegistration(reg);
      const next = await readPushState(reg, { win, vapidKey });
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [vapidKey]);

  return { state, setState, registration };
}

/**
 * The shared "turn on" tap. Nothing is awaited before `enablePush`, whose first await is the prompt.
 * `dismissed` (the prompt closed with no choice) changes nothing (UI-D-255).
 */
function useEnable(vapidKey: string | null, registration: PushRegistrationLike | null) {
  const t = useTranslations('notifications.push');
  const toast = useToast();
  return useCallback(
    (onResult: (result: 'on' | 'denied' | 'dismissed' | 'failed') => void) => {
      if (!registration || !vapidKey) return;
      enablePush({ registration, vapidKey })
        .then((result) => {
          if (result === 'on') toast.show({ tone: 'success', message: t('toasts.enabled') });
          if (result === 'denied') toast.show({ tone: 'info', message: t('toasts.denied') });
          onResult(result);
        })
        .catch((error: unknown) => {
          console.error('push.enable_failed', { error: String((error as Error)?.name) });
          toast.show({ tone: 'error', message: t('errors.failed') });
          onResult('failed');
        });
    },
    [registration, vapidKey, t, toast],
  );
}

export interface SoftAskProps {
  /** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, passed by the server page (null: every push surface is off). */
  vapidKey: string | null;
  tenantName: string;
  /** Staff (`chat.support`) get the staff body: they receive support messages, not broadcasts. */
  staff: boolean;
}

/**
 * The one-time soft-ask card (UI-D-255). Shown when the device can subscribe (or is iOS outside the
 * Home Screen app), is not subscribed, has not denied, and the member has not dismissed it on this
 * device. At most one per page; never on `/configuracoes`.
 */
export function SoftAsk({ vapidKey, tenantName, staff }: SoftAskProps) {
  const t = useTranslations('notifications.softAsk');
  const { state, setState, registration } = usePushDevice(vapidKey);
  const enable = useEnable(vapidKey, registration);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setDismissed(readSoftAskDismissed());
    return () => clearTimeout(leaveTimer.current);
  }, []);

  const leave = useCallback(() => {
    if (prefersReducedMotion()) {
      setGone(true);
      return;
    }
    setLeaving(true);
    leaveTimer.current = setTimeout(() => setGone(true), 150);
  }, []);

  const onActivate = useCallback(() => {
    if (state === 'ios-install') {
      setHintOpen(true);
      return;
    }
    setBusy(true);
    enable((result) => {
      setBusy(false);
      if (result === 'on' || result === 'denied') {
        setState(result as SettledState);
        leave();
      }
    });
  }, [state, enable, leave, setState]);

  const onDismiss = useCallback(() => {
    writeSoftAskDismissed();
    leave();
    // Focus moves to the "Novas" heading, or to the first row (UI-SPEC accessibility).
    const target =
      document.querySelector<HTMLElement>('[data-testid="notifications-unread"] h2') ??
      document.querySelector<HTMLElement>('[data-testid="notifications-read"] h2') ??
      document.querySelector<HTMLElement>('main a[href]');
    if (target) {
      if (!target.hasAttribute('tabindex') && target.tagName !== 'A') target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }, [leave]);

  const eligible =
    dismissed === false && !gone && (state === 'off' || state === 'ios-install' || busy);

  return (
    <>
      {eligible ? (
        <SoftAskCard
          title={t('title')}
          body={staff ? t('bodyStaff') : t('bodyMember', { tenant: tenantName })}
          cta={t('cta')}
          dismissLabel={t('dismiss')}
          busy={busy}
          leaving={leaving}
          onActivate={onActivate}
          onDismiss={onDismiss}
        />
      ) : null}
      <InstallHint open={hintOpen} variant="push" onClose={() => setHintOpen(false)} />
    </>
  );
}

export interface PushSettingRowProps {
  vapidKey: string | null;
  tenantName: string;
}

/** The Configurações "Notificações" row (UI-D-256): this device's switch in six states plus busy. */
export function PushSettingRow({ vapidKey, tenantName }: PushSettingRowProps) {
  const t = useTranslations('notifications.push');
  const tApp = useTranslations('app.settings.rows');
  const toast = useToast();
  const { state, setState, registration } = usePushDevice(vapidKey);
  const enable = useEnable(vapidKey, registration);
  const [busy, setBusy] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);

  const onToggle = useCallback(
    (next: boolean) => {
      if (state === 'ios-install') {
        setHintOpen(true);
        return;
      }
      if (!registration) return;
      if (next) {
        setBusy(true);
        enable((result) => {
          setBusy(false);
          if (result === 'on' || result === 'denied') setState(result);
        });
        return;
      }
      setBusy(true);
      void disablePush(registration).then(({ unsubscribed }) => {
        setBusy(false);
        if (unsubscribed) {
          setState('off');
          toast.show({ tone: 'success', message: t('toasts.disabled') });
        } else {
          // UI-D-256 error: the switch stays (reverts to) on and the error toast fires.
          setState('on');
          toast.show({ tone: 'error', message: t('errors.failed') });
        }
      });
    },
    [state, registration, enable, setState, toast, t],
  );

  return (
    <>
      <PushSwitchRow
        state={state}
        label={tApp('notifications')}
        subLines={{
          unsupported: t('state.unsupported'),
          'ios-install': t('state.iosInstall'),
          off: t('state.off'),
          on: t('state.on'),
          denied: t('state.denied', { tenant: tenantName }),
        }}
        switchLabel={t('switchLabel')}
        busy={busy}
        onToggle={onToggle}
      />
      <InstallHint open={hintOpen} variant="push" onClose={() => setHintOpen(false)} />
    </>
  );
}

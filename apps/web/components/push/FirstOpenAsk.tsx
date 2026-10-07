'use client';

import { BottomSheet, Button } from '@rede-social/ui';
import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { isStandalone, type WindowLike } from '@/components/pwa/InstallHint';
import {
  anotherModalOpen,
  firstOpenAskDue,
  readFirstOpenAsked,
  writeFirstOpenAsked,
} from '@/lib/push';
import { useEnable, usePushDevice } from './PushControls';

/**
 * The one-time notification ask of the installed app (quick 261007-kyp, NOTIF-03, PWA-02): a bottom
 * sheet on the FIRST open of the home-screen app, on top of the existing push flow.
 *
 * Eligibility (`firstOpenAskDue`): standalone display mode, push state `off` (supported, permission
 * still `default`, not subscribed; `denied`, `on` and `unsupported` never qualify), a VAPID key (the
 * layout renders this only when the notifications module is on) and no stored answer. The server
 * renders nothing: the display mode and the stored answer are read after mount.
 *
 * Timing: it opens FIRST_OPEN_ASK_DELAY_MS after it becomes due, and only while no other
 * `[aria-modal="true"]` dialog is open: the profile nudge popup rises on Início and traps focus, and
 * two focus traps at once ping-pong. A blocked check retries every FIRST_OPEN_ASK_RETRY_MS, at most
 * FIRST_OPEN_ASK_MAX_WAITS times; giving up stores nothing, so the next open tries again.
 *
 * Nothing prompts from an effect: the CTA runs the shared `useEnable` -> `enablePush`, whose first
 * await is the permission prompt (lib/push.ts fact 1). `on` and `denied` store their answer and close;
 * `dismissed` (the browser prompt was closed with no choice) and `failed` keep the sheet open
 * (UI-D-255), the shared hook already toasts a failure. "Agora não", Escape, the backdrop and a
 * drag-down store `later` and close. The stored answer is a UX flag that authorizes nothing.
 */
export const FIRST_OPEN_ASK_DELAY_MS = 1500;
export const FIRST_OPEN_ASK_RETRY_MS = 1000;
export const FIRST_OPEN_ASK_MAX_WAITS = 20;

export interface FirstOpenAskProps {
  /** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, passed by the layout only when the notifications module is on. */
  vapidKey: string;
  tenantName: string;
  /** Staff (`chat.support`) get the staff body: they receive support messages, not broadcasts. */
  staff: boolean;
}

export function FirstOpenAsk({ vapidKey, tenantName, staff }: FirstOpenAskProps) {
  const t = useTranslations('notifications.softAsk');
  const tp = useTranslations('pwa');
  const { state, setState, registration } = usePushDevice(vapidKey);
  const enable = useEnable(vapidKey, registration);
  const [standalone, setStandalone] = useState(false);
  // Treated as asked until the mount effect has read the store, so nothing opens early.
  const [asked, setAsked] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone(window as WindowLike));
    setAsked(readFirstOpenAsked());
  }, []);

  const due = firstOpenAskDue({ standalone, state, asked });

  useEffect(() => {
    if (!due || open) return;
    let waits = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (!anotherModalOpen(document)) {
        setOpen(true);
        return;
      }
      waits += 1;
      if (waits >= FIRST_OPEN_ASK_MAX_WAITS) return;
      timer = setTimeout(attempt, FIRST_OPEN_ASK_RETRY_MS);
    };
    timer = setTimeout(attempt, FIRST_OPEN_ASK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, open]);

  const later = useCallback(() => {
    writeFirstOpenAsked('later');
    setAsked(true);
    setOpen(false);
  }, []);

  const onActivate = useCallback(() => {
    setBusy(true);
    enable((result) => {
      setBusy(false);
      if (result === 'on' || result === 'denied') {
        writeFirstOpenAsked(result === 'on' ? 'enabled' : 'denied');
        setState(result);
        setAsked(true);
        setOpen(false);
      }
    });
  }, [enable, setState]);

  return (
    <BottomSheet open={open} onClose={later} title={t('title')}>
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
          <BellRing aria-hidden size={28} />
        </div>
        <p className="text-sm leading-relaxed text-text-secondary">
          {staff ? t('bodyStaff') : t('bodyMember', { tenant: tenantName })}
        </p>
        <div className="flex w-full flex-col gap-2 pt-2">
          <Button variant="brand" fullWidth loading={busy} onClick={onActivate}>
            {t('cta')}
          </Button>
          <Button variant="ghost" fullWidth onClick={later}>
            {tp('install.dismiss')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

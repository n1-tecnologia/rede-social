'use client';

import { Card, ConfirmDialog, SectionTitle, Switch, useToast } from '@rede-social/ui';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { previewGateAction, setGateAction } from './actions';

export interface GateSwitchRowProps {
  tenantName: string;
  /** The switch as the server stored it. */
  required: boolean;
  /**
   * The server's verdict (A-UI-2, D-491): an integration is connected AND at least one access product
   * exists. The row renders it; it never derives it.
   */
  canEnable: boolean;
  /** Called with the switch's new value, from the server's answer only. */
  onRequiredChange?: (required: boolean) => void;
}

const RELEASE_ID = 'payments-gate-release';

/**
 * The gate switch (09.1-13, UI-D-516, D-491, D-492, PAY-08, PAY-31, A-UI-2, A-UI-10,
 * T-09.1-64): the one control that can lock a community, so it is a deliberate act that names the
 * people it touches.
 *
 * **Turning ON never calls the write at once.** It first reads the preview: `count` (members with no
 * access record, who a release would admit) and, separately, `gatewayCut` (members the gateway has cut,
 * who stay cut because D-489 ranks the cut above a manual release; G-09.1-1), staff excluded from both;
 * a failed read toasts and leaves the switch off, because no answer means no save (the 08.2
 * lock-preview rule). Then the confirmation: with nobody to cut, a brand dialog; with `n` members, the
 * plural body and ONE release checkbox, CHECKED by default, so tapping the confirm without touching
 * anything cuts nobody. Clearing the box is the deliberate act, and the dialog's tone turns `danger`
 * with it (this row recomputes `tone` from the box; the dialog only renders it). Whenever `gatewayCut`
 * is above zero one more line says those members stay cut (A-G3): information only, no control, and it
 * never changes the tone.
 *
 * **The web never decides who has access.** It sends the admin's intent, `{ required: true,
 * releaseExisting: <the box> }`, and renders what the server answers: the switch changes only from the
 * answer (no optimistic flip, the Membros rule) and the success toast reports the SERVER's `released`,
 * never the preview's figure, because the preview is a snapshot and the write releases whoever has no
 * access when it runs. The flip and the releases are one server write, so a failure releases nobody.
 *
 * Turning OFF needs no confirmation: nobody loses anything, so one tap, `busy` until the answer.
 */
export function GateSwitchRow({
  tenantName,
  required,
  canEnable,
  onRequiredChange,
}: GateSwitchRowProps) {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const [checked, setChecked] = useState(required);
  const [previewing, setPreviewing] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [writing, setWriting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [cut, setCut] = useState(0);
  const [release, setRelease] = useState(true);

  const disabled = !canEnable && !checked;

  function lostPermission() {
    toast.show({ tone: 'error', message: t('admin.errors.forbidden') });
    router.refresh();
  }

  async function startOn() {
    setPreviewing(true);
    let outcome: Awaited<ReturnType<typeof previewGateAction>> = { ok: false, code: 'generic' };
    try {
      outcome = await previewGateAction();
    } catch {
      // No answer means no save: the switch stays off.
    } finally {
      setPreviewing(false);
    }
    if (!outcome.ok) {
      if (outcome.code === 'forbidden') lostPermission();
      else toast.show({ tone: 'error', message: t('payments.errors.preview') });
      return;
    }
    setCount(outcome.count);
    setCut(outcome.gatewayCut);
    setRelease(true);
    setDialogOpen(true);
  }

  async function confirmOn() {
    setWriting(true);
    let outcome: Awaited<ReturnType<typeof setGateAction>> = { ok: false, code: 'generic' };
    try {
      outcome = await setGateAction({ required: true, releaseExisting: count > 0 && release });
    } catch {
      // Falls through to the generic failure toast; the switch was never flipped.
    } finally {
      setWriting(false);
    }
    if (outcome.ok) {
      setChecked(outcome.required);
      onRequiredChange?.(outcome.required);
      toast.show({
        tone: 'success',
        message:
          outcome.released > 0
            ? t('payments.toasts.gateOnReleased', { released: outcome.released })
            : t('payments.toasts.gateOn'),
      });
      return;
    }
    if (outcome.code === 'forbidden') {
      lostPermission();
      return;
    }
    toast.show({ tone: 'error', message: t('payments.errors.generic') });
    // A stale "can enable" (the setup changed elsewhere): catch the disabled state up with the server.
    if (outcome.code === 'gate_requires_setup') router.refresh();
  }

  async function turnOff() {
    setPersisting(true);
    let outcome: Awaited<ReturnType<typeof setGateAction>> = { ok: false, code: 'generic' };
    try {
      outcome = await setGateAction({ required: false });
    } catch {
      // Falls through to the generic failure toast; the switch stays on.
    } finally {
      setPersisting(false);
    }
    if (outcome.ok) {
      setChecked(outcome.required);
      onRequiredChange?.(outcome.required);
      toast.show({ tone: 'success', message: t('payments.toasts.gateOff') });
      return;
    }
    if (outcome.code === 'forbidden') {
      lostPermission();
      return;
    }
    toast.show({ tone: 'error', message: t('payments.errors.generic') });
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{t('payments.gate.section')}</SectionTitle>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-text">{t('payments.gate.title')}</p>
            <p className="mt-1 text-xs font-normal text-text-secondary">
              {t('payments.gate.helper')}
            </p>
          </div>
          <Switch
            checked={checked}
            label={t('payments.gate.title')}
            busy={previewing || persisting}
            disabled={disabled}
            aria-disabled={disabled || undefined}
            onChange={(next) => {
              if (next) void startOn();
              else void turnOff();
            }}
          />
        </div>
        {disabled ? (
          <p className="mt-2 text-xs font-normal text-text-tertiary">
            {t('payments.gate.disabledNote')}
          </p>
        ) : null}
      </Card>

      <ConfirmDialog
        open={dialogOpen}
        icon={ShieldCheck}
        scrollBody
        tone={count > 0 && !release ? 'danger' : 'brand'}
        title={t('payments.gate.dialog.title', { tenant: tenantName })}
        body={
          count > 0
            ? t('payments.gate.dialog.body', { n: count })
            : t('payments.gate.dialog.bodyNone')
        }
        confirmLabel={t('payments.gate.confirm')}
        cancelLabel={t('payments.gate.cancel')}
        onConfirm={confirmOn}
        onClose={() => setDialogOpen(false)}
      >
        {count > 0 || cut > 0 ? (
          <>
            {count > 0 ? (
              <>
                <div className="flex min-h-11 items-start gap-3">
                  <input
                    id={RELEASE_ID}
                    type="checkbox"
                    checked={release}
                    disabled={writing}
                    onChange={(event) => setRelease(event.target.checked)}
                    className="size-5 shrink-0 rounded border-border accent-brand"
                  />
                  <label htmlFor={RELEASE_ID} className="text-sm font-normal text-text">
                    {t('payments.gate.dialog.releaseLabel', { n: count })}
                  </label>
                </div>
                <p aria-live="polite" className="mt-1 text-xs font-normal text-text-tertiary">
                  {release
                    ? t('payments.gate.dialog.releaseHelperOn')
                    : t('payments.gate.dialog.releaseHelperOff')}
                </p>
              </>
            ) : null}
            {cut > 0 ? (
              <p className="mt-2 text-xs font-normal text-text-secondary">
                {t('payments.gate.dialog.cutNote', { cut })}
              </p>
            ) : null}
          </>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

'use client';

import type { AccessItem } from '@rede-social/module-payments/contracts';
import { BottomSheet, Button, Input, useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { type AccessWriteOutcome, releaseEmailAction } from './actions';

/** What the sheet hands back to its host: the server's row, a vanished row or a lost permission. */
export type ReleaseSettled =
  | {
      kind: 'released';
      email: string;
      /** The row as the server now has it; `null` is not expected but is handled as "refresh". */
      access: AccessItem | null;
      serverNow: string;
    }
  | { kind: 'gone'; email: string }
  | { kind: 'forbidden' };

export interface ReleaseEmailSheetProps {
  open: boolean;
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** Success, a vanished row (404) or a lost permission (403): the HOST closes, toasts and updates. */
  onSettled: (outcome: ReleaseSettled) => void;
}

const EMAIL_ID = 'payments-release-email';

/**
 * The "Liberar e-mail" sheet (09.1-14, UI-D-518, D-490, D-504): one e-mail field and one brand submit,
 * for releasing an address BEFORE the person has an account.
 *
 * - **The server decides.** The address is sent as typed; the API normalises it, refuses a malformed
 *   one (`email_invalid`) and a blocked one (409 `blocked`), and answers the row it now holds. Each
 *   refusal has its own line UNDER the field with `role="alert"`; the next edit clears it. Any other
 *   failure toasts the release line and KEEPS the sheet open with what was typed.
 * - **Disabled until there is an address.** The submit is disabled while the field is empty or only
 *   spaces; an address that is merely wrong is the server's `email_invalid`, not a client guess.
 * - **Nothing is optimistic.** A success goes to the host, which puts the server's row at the top.
 *
 * The sheet remounts per opening (the host keys it), so every opening starts empty.
 */
export function ReleaseEmailSheet({ open, onClose, onSettled }: ReleaseEmailSheetProps) {
  const t = useTranslations();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const empty = email.trim() === '';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || empty) return;

    setPending(true);
    let outcome: AccessWriteOutcome = { ok: false, code: 'generic' };
    try {
      outcome = await releaseEmailAction(email);
    } catch {
      // A network failure reads like any other failed write: the sheet stays open.
    } finally {
      setPending(false);
    }

    const typed = email.trim().toLowerCase();
    if (outcome.ok) {
      onSettled({
        kind: 'released',
        email: outcome.access?.email ?? typed,
        access: outcome.access,
        serverNow: outcome.serverNow,
      });
      return;
    }
    switch (outcome.code) {
      case 'email_invalid':
        setError(t('payments.errors.emailInvalid'));
        return;
      case 'blocked':
        setError(t('payments.errors.emailBlocked'));
        return;
      case 'gone':
        onSettled({ kind: 'gone', email: typed });
        return;
      case 'forbidden':
        onSettled({ kind: 'forbidden' });
        return;
      default:
        toast.show({ tone: 'error', message: t('payments.errors.release') });
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('payments.access.releaseSheet.title')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Input
            id={EMAIL_ID}
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            label={t('payments.access.releaseSheet.emailLabel')}
            value={email}
            error={error}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(undefined);
            }}
          />
          <p className="text-xs font-normal text-text-tertiary">
            {t('payments.access.releaseSheet.helper')}
          </p>
        </div>
        <Button type="submit" fullWidth loading={pending} disabled={empty}>
          {t('payments.access.releaseSheet.submit')}
        </Button>
      </form>
    </BottomSheet>
  );
}

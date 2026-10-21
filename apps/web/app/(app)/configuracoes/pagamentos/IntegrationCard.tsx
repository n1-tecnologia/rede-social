'use client';

import {
  Button,
  Card,
  IconButton,
  Input,
  SectionTitle,
  StatusPill,
  useToast,
} from '@rede-social/ui';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';
import type { IntegrationView } from '@/lib/payments-view';
import { saveIntegrationAction } from './actions';

export interface IntegrationCardProps {
  view: IntegrationView;
  /** Called once the token is saved, so the host can derive what depends on the connection. */
  onConnected?: () => void;
}

const URL_ID = 'payments-webhook-url';
const TOKEN_ID = 'payments-webhook-token';
const HELPER_ID = 'payments-webhook-token-helper';

/**
 * The Integração card of the Configuração tab (09.1-13, UI-D-514, D-486, PAY-04, T-09.1-60), top to
 * bottom in the order an admin does the setup: where to paste the URL, what to paste back, save, and
 * the proof that it works.
 *
 * **The token is write-only on screen** (E02 interaction): the field is `type="password"` with
 * `autoComplete="off"`, `spellCheck={false}` and `data-1p-ignore`, it has NO `name` a password manager
 * recognises and NO show/hide control, it is never pre-filled (connected or not), and a successful save
 * clears it. The value lives only in this component's state until `saveIntegrationAction` takes it; no
 * prop, data attribute, log line or error message carries it, and a failed save keeps what the admin
 * typed so they can retry.
 *
 * The connection state is local, flipped from the server's answer (never optimistic): the pill reads
 * "Conectado" only after the write succeeded. The last-event line arrives finished from the server
 * (`overviewView`), so this card reads no clock.
 */
export function IntegrationCard({ view, onConnected }: IntegrationCardProps) {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const urlRef = useRef<HTMLInputElement>(null);
  const [connected, setConnected] = useState(view.connected);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const gateway = { gateway: view.gatewayName };
  const tokenRequired = t('payments.errors.tokenRequired');

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(view.webhookUrl);
      toast.show({ tone: 'success', message: t('payments.setup.copied') });
    } catch {
      // No clipboard permission: select the URL so a long-press copy still works.
      urlRef.current?.select();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (token.trim() === '') {
      setError(tokenRequired);
      return;
    }
    setPending(true);
    let outcome: Awaited<ReturnType<typeof saveIntegrationAction>> = { ok: false, code: 'generic' };
    try {
      outcome = await saveIntegrationAction(token);
    } catch {
      // A network failure reads like any other failed write: the typed token stays.
    } finally {
      setPending(false);
    }

    if (outcome.ok) {
      setToken('');
      setError(null);
      setConnected(true);
      toast.show({ tone: 'success', message: t('payments.toasts.setupSaved') });
      onConnected?.();
      return;
    }
    if (outcome.code === 'token_required') {
      setError(tokenRequired);
      return;
    }
    if (outcome.code === 'forbidden') {
      toast.show({ tone: 'error', message: t('admin.errors.forbidden') });
      router.refresh();
      return;
    }
    toast.show({ tone: 'error', message: t('payments.errors.saveSetup') });
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{t('payments.setup.title')}</SectionTitle>
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
            {view.gatewayName}
          </span>
          <StatusPill tone={connected ? 'success' : 'neutral'} className="shrink-0">
            {connected ? t('payments.setup.connected') : t('payments.setup.notConnected')}
          </StatusPill>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={URL_ID} className="text-sm font-normal text-text-secondary">
            {t('payments.setup.urlLabel')}
          </label>
          <div className="flex items-center gap-2">
            <Input
              ref={urlRef}
              id={URL_ID}
              readOnly
              value={view.webhookUrl}
              className="select-all"
              containerClassName="min-w-0 flex-1"
            />
            <IconButton
              icon={Copy}
              size={20}
              label={t('payments.setup.copy')}
              onClick={copyUrl}
              className="shrink-0"
            />
          </div>
          <p className="text-xs font-normal text-text-tertiary">
            {t('payments.setup.urlHelper', gateway)}
          </p>
        </div>

        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Input
              id={TOKEN_ID}
              type="password"
              label={t('payments.setup.tokenLabel')}
              placeholder={
                connected
                  ? t('payments.setup.tokenSavedPlaceholder')
                  : t('payments.setup.tokenPlaceholder', gateway)
              }
              value={token}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              error={error ?? undefined}
              aria-describedby={error ? `${TOKEN_ID}-error ${HELPER_ID}` : HELPER_ID}
              onChange={(event) => {
                setToken(event.target.value);
                setError(null);
              }}
              onBlur={() => {
                // F-3: a field left empty says what it needs, while the button stays disabled. Once
                // connected an empty field is the normal state, so nothing is said.
                if (!connected && token === '') setError(tokenRequired);
              }}
            />
            <p id={HELPER_ID} className="text-xs font-normal text-text-tertiary">
              {t('payments.setup.tokenHelper')}
            </p>
          </div>
          <Button type="submit" size="md" loading={pending} disabled={token === ''}>
            {pending ? t('payments.setup.saving') : t('payments.setup.save')}
          </Button>
        </form>

        <div className="flex items-center justify-between gap-3 border-t border-divider pt-4">
          <p className="min-w-0 flex-1 text-xs font-normal text-text-tertiary">{view.lastEvent}</p>
          {view.showEventsLink ? (
            <Link
              href={view.eventsHref}
              className="inline-flex min-h-11 shrink-0 items-center text-xs font-bold text-brand"
            >
              {t('payments.setup.seeEvents')}
            </Link>
          ) : null}
        </div>
      </Card>
    </section>
  );
}

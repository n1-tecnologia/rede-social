'use client';

import { Button, Card, ConfirmDialog, StatusPill, useToast } from '@rede-social/ui';
import { CheckCircle2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState, useTransition } from 'react';
import { DnsRecordsTable, type DnsRecordView } from './DnsRecordsTable';

/** `tenant_domains.verification_status` as the card knows it (mirrors `domainStatusSchema`). */
export type DomainStatus = 'pending' | 'verified' | 'expired' | 'failed';

/**
 * One host as the card renders it — built on the server by `toDomainCardView` from the parsed
 * `tenantDomainSchema` row (dates already formatted, the D-35 rules already decided).
 */
export type DomainCardView = {
  id: string;
  host: string;
  isPrimary: boolean;
  status: DomainStatus;
  records: DnsRecordView[];
  /** `formatPanelDate(lastCheckedAt, 'dateTime')` or null when never checked. */
  lastCheckedLabel: string | null;
  lastError: string | null;
  /** False on the primary host while other hosts exist (D-35): disabled button + helper. */
  canRemove: boolean;
  /** Verified and not primary (D-35). */
  canSetPrimary: boolean;
  /** Pending / failed, or verified with a last error (the API re-runs the idempotent side effects). */
  showVerify: boolean;
  /** Expired (D-34). */
  showRestart: boolean;
};

/** Catalog KEYS of `platformDomains.errors` a domain action can answer with — the card translates. */
export type DomainActionError =
  | 'expired'
  | 'notExpired'
  | 'notVerified'
  | 'removePrimary'
  | 'notFound'
  | 'generic';

/** What `verifyDomainAction` / `setPrimaryDomainAction` / `removeDomainAction` / `restartDomainAction` answer. */
export type DomainActionResult =
  | { ok: true; status: DomainStatus; lastError: string | null }
  | { ok: false; error: DomainActionError };

export type DomainAction = (tenantId: string, domainId: string) => Promise<DomainActionResult>;

export interface DomainCardLabels {
  status: Record<DomainStatus, string>;
  primary: string;
  helper: string;
  card: {
    neverChecked: string;
    verify: string;
    verifying: string;
    restart: string;
    restarting: string;
    setPrimary: string;
    remove: string;
    removePrimaryHelper: string;
  };
  dns: {
    title: string;
    type: string;
    name: string;
    value: string;
    copy: string;
    copied: string;
  };
  confirm: {
    removeBody: string;
    remove: string;
    primaryBody: string;
    primary: string;
    cancel: string;
  };
  /** `confirm.removeTitle` already interpolated with the host. */
  confirmRemoveTitle: string;
  /** `confirm.primaryTitle` already interpolated with the host. */
  confirmPrimaryTitle: string;
  toasts: {
    removed: string;
    primaryUpdated: string;
    verified: string;
    restarted: string;
    error: string;
  };
  errors: Record<DomainActionError, string> & {
    /** Raw ICU template with `{reason}` — interpolated here with the API's `lastError`. */
    verifyFailedTemplate: string;
    verifyPendingReason: string;
  };
  /** `card.lastError` already interpolated with the reason, or null. */
  lastErrorLabel: string | null;
}

export interface DomainCardProps {
  tenantId: string;
  view: DomainCardView;
  labels: DomainCardLabels;
  /** The four server actions; the API call + layout revalidation live there. */
  actions: {
    verify: DomainAction;
    setPrimary: DomainAction;
    remove: DomainAction;
    restart: DomainAction;
  };
}

const STATUS_TONE: Record<DomainStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  verified: 'success',
  expired: 'danger',
  failed: 'danger',
};

/** `{name}` placeholders → values; the only client-side interpolation of the panel (raw ICU string). */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * One host of the Domínios tab (D-34/D-35, mockup `tenant-page-dominios`): host 16/700, the
 * "Primário" brand pill, the status pill, the last-check line; while not verified the DNS table
 * with the helper; then the action row — "Verificar agora" / "Reiniciar verificação",
 * "Tornar primário" (confirmed, brand), "Remover" (confirmed, danger; disabled with the helper on
 * the primary while aliases exist). Every outcome ends with exactly one toast; the card never keeps
 * row state — the action revalidates the tenant layout and the server re-renders the card.
 */
export function DomainCard({ tenantId, view, labels, actions }: DomainCardProps) {
  const toast = useToast();
  const [verifying, startVerify] = useTransition();
  const [restarting, startRestart] = useTransition();
  const [dialog, setDialog] = useState<'remove' | 'primary' | null>(null);

  const errorMessage = (error: DomainActionError): string =>
    labels.errors[error] ?? labels.toasts.error;

  const verify = () => {
    startVerify(async () => {
      const result = await actions.verify(tenantId, view.id);
      if (result.ok && result.status === 'verified') {
        toast.show({ tone: 'success', message: labels.toasts.verified });
      } else if (result.ok) {
        toast.show({
          tone: 'error',
          message: interpolate(labels.errors.verifyFailedTemplate, {
            reason: result.lastError ?? labels.errors.verifyPendingReason,
          }),
        });
      } else {
        toast.show({ tone: 'error', message: errorMessage(result.error) });
      }
    });
  };

  const restart = () => {
    startRestart(async () => {
      const result = await actions.restart(tenantId, view.id);
      toast.show(
        result.ok
          ? { tone: 'success', message: labels.toasts.restarted }
          : { tone: 'error', message: errorMessage(result.error) },
      );
    });
  };

  const confirmed = (action: DomainAction) => async () => {
    const result = await action(tenantId, view.id);
    if (!result.ok) throw new Error(result.error);
  };

  const failed = (error: unknown) => {
    const key = error instanceof Error ? (error.message as DomainActionError) : 'generic';
    toast.show({ tone: 'error', message: errorMessage(key) });
  };

  const showDns = view.status !== 'verified';

  return (
    <>
      <Card className="flex flex-col gap-4 p-4 md:p-6" data-testid="domain-card">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3
            className="min-w-0 max-w-full truncate text-base font-bold text-text"
            title={view.host}
          >
            {view.host}
          </h3>
          {view.isPrimary ? <StatusPill tone="brand">{labels.primary}</StatusPill> : null}
          <StatusPill tone={STATUS_TONE[view.status]}>{labels.status[view.status]}</StatusPill>
          <span className="text-xs text-text-tertiary">
            {view.lastCheckedLabel ?? labels.card.neverChecked}
          </span>
        </div>

        {showDns ? (
          <div className="flex min-w-0 flex-col gap-3">
            {view.records.length > 0 ? (
              <DnsRecordsTable
                records={view.records}
                labels={{ ...labels.dns, copyError: labels.toasts.error }}
              />
            ) : null}
            <p className="text-sm text-text-secondary">{labels.helper}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {view.showVerify ? (
              <Button variant="outline" size="sm" loading={verifying} onClick={verify}>
                {verifying ? null : <RefreshCw aria-hidden size={16} />}
                {verifying ? labels.card.verifying : labels.card.verify}
              </Button>
            ) : null}
            {view.showRestart ? (
              <Button variant="outline" size="sm" loading={restarting} onClick={restart}>
                {restarting ? null : <RefreshCw aria-hidden size={16} />}
                {restarting ? labels.card.restarting : labels.card.restart}
              </Button>
            ) : null}
            {view.canSetPrimary ? (
              <Button variant="ghost" size="sm" onClick={() => setDialog('primary')}>
                {labels.card.setPrimary}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              disabled={!view.canRemove}
              onClick={() => setDialog('remove')}
            >
              {labels.card.remove}
            </Button>
          </div>
          {!view.canRemove ? (
            <p className="text-xs text-text-secondary">{labels.card.removePrimaryHelper}</p>
          ) : null}
          {view.lastError && labels.lastErrorLabel ? (
            <p className="break-words text-xs text-danger">{labels.lastErrorLabel}</p>
          ) : null}
        </div>
      </Card>

      {view.canSetPrimary ? (
        <ConfirmDialog
          open={dialog === 'primary'}
          tone="brand"
          icon={CheckCircle2}
          title={labels.confirmPrimaryTitle}
          body={labels.confirm.primaryBody}
          confirmLabel={labels.confirm.primary}
          cancelLabel={labels.confirm.cancel}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await confirmed(actions.setPrimary)();
            toast.show({ tone: 'success', message: labels.toasts.primaryUpdated });
          }}
          onError={failed}
        />
      ) : null}

      {view.canRemove ? (
        <ConfirmDialog
          open={dialog === 'remove'}
          tone="danger"
          icon={TriangleAlert}
          title={labels.confirmRemoveTitle}
          body={labels.confirm.removeBody}
          confirmLabel={labels.confirm.remove}
          cancelLabel={labels.confirm.cancel}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await confirmed(actions.remove)();
            toast.show({ tone: 'success', message: labels.toasts.removed });
          }}
          onError={failed}
        />
      ) : null}
    </>
  );
}

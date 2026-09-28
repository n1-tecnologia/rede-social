'use client';

import { Button, Card, ConfirmDialog, SectionTitle, StatusPill, useToast } from '@rede-social/ui';
import { Ban, CheckCircle2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

export interface StatusCardProps {
  tenantId: string;
  tenantName: string;
  status: 'active' | 'suspended';
  /** `setTenantStatusAction` — the API call + layout revalidation live in the server action. */
  action: (
    tenantId: string,
    status: 'active' | 'suspended',
  ) => Promise<{ ok: true } | { ok: false; code: string }>;
}

/**
 * Status tab card (D-32, mockup `tenant-page-status`): the state pill (14 px), the explanatory copy
 * and exactly ONE CTA. Suspending is destructive and goes through `ConfirmDialog` (danger tone,
 * both footer buttons disabled with the spinner while pending — E21); reactivating is immediate.
 * Every outcome ends with a toast; the header pill flips because the action revalidated the layout.
 */
export function StatusCard({ tenantId, tenantName, status, action }: StatusCardProps) {
  const t = useTranslations('platform');
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = status === 'active';

  const reactivate = () => {
    startTransition(async () => {
      const result = await action(tenantId, 'active');
      toast.show(
        result.ok
          ? { tone: 'success', message: t('toasts.saved') }
          : { tone: 'error', message: t('toasts.error') },
      );
    });
  };

  return (
    <>
      <Card className="flex flex-col gap-4 p-4 md:p-6">
        <SectionTitle variant="micro">{t('status.title')}</SectionTitle>
        <div>
          <StatusPill tone={active ? 'success' : 'danger'} className="text-sm">
            {active ? t('tenantStatus.active') : t('tenantStatus.suspended')}
          </StatusPill>
        </div>
        <p className="text-sm leading-relaxed text-text-secondary">{t('status.body')}</p>
        <div>
          {active ? (
            <Button
              variant="danger"
              onClick={() => setConfirmOpen(true)}
              className="w-full md:w-auto"
            >
              <Ban aria-hidden size={18} />
              {t('status.suspend')}
            </Button>
          ) : (
            <Button
              variant="brand"
              loading={pending}
              onClick={reactivate}
              className="w-full md:w-auto"
            >
              {pending ? null : <CheckCircle2 aria-hidden size={18} />}
              {pending ? t('status.reactivatePending') : t('status.reactivate')}
            </Button>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        icon={TriangleAlert}
        title={t('status.confirmTitle', { tenant: tenantName })}
        body={t('status.confirmBody')}
        confirmLabel={t('status.confirm')}
        cancelLabel={t('status.cancel')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const result = await action(tenantId, 'suspended');
          if (!result.ok) throw new Error(result.code);
          toast.show({ tone: 'success', message: t('toasts.saved') });
        }}
        onError={() => toast.show({ tone: 'error', message: t('toasts.error') })}
      />
    </>
  );
}

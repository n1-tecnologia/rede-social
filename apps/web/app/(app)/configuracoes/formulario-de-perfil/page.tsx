import { buttonClasses, EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadAdminForm, loadArchived } from '@/lib/profile-form/admin-reads';
import { ArchivedList } from './ArchivedList';
import { FormSummaryCard } from './FormSummaryCard';
import { ProfileFormTabs } from './ProfileFormTabs';
import { QuestionBuilder } from './QuestionBuilder';
import { PROFILE_FORM_TABS, parseTab, profileFormTabHref } from './tabs';

/**
 * `/configuracoes/formulario-de-perfil` (12-15, D-582, D-589, D-596, UI-D-564..UI-D-568; PFORM-02,
 * PFORM-03, PFORM-23, PFORM-26): the admin's builder, reached from the Configurações "Formulário de
 * perfil" row and nowhere else. A frame (the Regras `PageHeader` and body width, the underline tabs
 * Perguntas · Arquivadas) over a body per tab.
 *
 * **`notFound()`, never a 403 screen** (the `/configuracoes/pagamentos` precedent): the route answers the
 * app's own not-found page unless the bootstrap carries the composed `profile_form.manage` (the value
 * the API's `requirePermission` reads, composed for `admin_tenant` only while the module is on), and when
 * a read comes back 403 or 404 (the permission lost, or the module turned off, since the bootstrap). A
 * support user or a member must not learn the screen exists. `notFound()` throws, so it sits outside any
 * try/catch (Next 16): the loaders never throw for an expected refusal.
 *
 * `?aba=` is read here on the server (`parseTab`): an unknown or repeated value is Perguntas, so a tab
 * change, a refresh, back and a shared link land on the same tab. The tab reads once per request on the
 * server and every write refreshes, so nothing is cached on the client.
 */
export default async function ProfileFormPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [bootstrap, t, params] = await Promise.all([
    requireBootstrap(),
    getTranslations('profileForm.admin'),
    searchParams,
  ]);
  if (!bootstrap.permissions.includes('profile_form.manage')) notFound();

  const tab = parseTab(params.aba);

  const readFailed = (
    <EmptyState
      variant="card"
      data-profile-form-error
      icon={CircleAlert}
      title={t('errors.title')}
      body={t('errors.body')}
      action={
        <Link
          href={profileFormTabHref(tab)}
          className={buttonClasses({ variant: 'outline', size: 'md' })}
        >
          {t('errors.retry')}
        </Link>
      }
    />
  );

  let body: ReactNode = null;
  if (tab === 'archived') {
    const archived = await loadArchived();
    if (archived.status === 'forbidden' || archived.status === 'moduleOff') notFound();
    body =
      archived.status === 'error' ? (
        readFailed
      ) : (
        <ArchivedList
          questions={archived.questions}
          branches={archived.branches}
          activeCount={archived.activeCount}
          limit={archived.limit}
          activeQuestions={archived.activeQuestions}
          timeZone={bootstrap.tenant.timezone}
        />
      );
  } else {
    const loaded = await loadAdminForm();
    if (loaded.status === 'forbidden' || loaded.status === 'moduleOff') notFound();
    if (loaded.status === 'error') {
      body = readFailed;
    } else {
      // The builder shows the empty state (with its one brand call to action) when no question is active;
      // the summary card stays above it only when archived questions exist (their answers are kept, so
      // there is progress to report).
      const hasQuestions = loaded.questions.length > 0;
      const hasArchived = (loaded.archivedCount ?? 0) > 0;
      body = (
        <>
          <p className="text-sm font-normal text-text-secondary">
            {t('intro', { tenant: bootstrap.tenant.displayName })}
          </p>
          {hasQuestions || hasArchived ? <FormSummaryCard summary={loaded.summary} /> : null}
          <QuestionBuilder
            questions={loaded.questions}
            steps={loaded.steps}
            branches={loaded.branches}
            stepLimit={loaded.stepLimit}
            limit={loaded.limit}
            tenantName={bootstrap.tenant.displayName}
          />
        </>
      );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <ProfileFormTabs
        label={t('tabs.label')}
        value={tab}
        items={PROFILE_FORM_TABS.map((key) => ({
          key,
          label: t(`tabs.${key}`),
          href: profileFormTabHref(key),
        }))}
        className="border-b border-divider"
      />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-0">{body}</div>
    </div>
  );
}

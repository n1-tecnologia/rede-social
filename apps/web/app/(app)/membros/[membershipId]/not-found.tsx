import { EmptyState } from '@tria/ui';
import { UserX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * "Membro não encontrado" — the ONE screen every miss on `/membros/[membershipId]` lands on:
 * an unknown id, another tenant's id, an invited, a blocked or a soft-deleted membership. The API
 * already answers one indistinguishable bare 404 for all five (D-23/TENANT-04); this is the visual
 * half of the same rule, and it never tells the member WHY.
 *
 * **It takes no props and reads no param or search param on purpose** (the `/endereco-invalido`
 * posture from 01-05): a component that cannot see the id it was reached with cannot echo it, and a
 * component that reads no tenant cannot name one. The body is a fixed catalog string.
 */
export default async function MemberNotFound() {
  const t = await getTranslations('members');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
      <EmptyState
        variant="card"
        icon={UserX}
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <a
            href="/membros"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}

import { Card, Skeleton } from '@rede-social/ui';
import { CircleAlert, ClipboardList, Eye } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ProfileEmptyCard, ProfileSection } from '@/components/profile/ProfileSection';
import { answerWordsFrom, type WordsTranslator } from '@/lib/profile-form/answer-view';
import { loadMyAnswers, type MyAnswerRow } from '@/lib/profile-form/profile-reads';
import { AnswerValue } from './AnswerValue';

/** Where "Editar" and "Responder" go: the same screen and the same save route as the first answer (PFORM-20). */
export const EDIT_ANSWERS_HREF = '/completar-perfil?next=%2Fperfil';

/** More rows than this collapse behind a native `<details>` (UI-D-590). */
export const VISIBLE_ANSWER_ROWS = 4;

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The three-row skeleton the section streams in with (UI-D-590): a 12px bar over a 14px bar, `p-4`. It
 * carries `aria-busy` and no spinner.
 */
export function MyAnswersSkeleton() {
  return (
    <div aria-busy data-testid="my-answers-skeleton">
      <Card className="divide-y divide-border mx-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-2 p-4">
            <Skeleton variant="text" width="40%" className="h-3" />
            <Skeleton variant="text" width="70%" className="h-3.5" />
          </div>
        ))}
      </Card>
    </div>
  );
}

function AnswerRow({ row, t }: { row: MyAnswerRow; t: Translator }) {
  return (
    <div data-answer-row={row.questionId} className="flex min-w-0 flex-col gap-1 p-4">
      <span className="break-words text-xs font-normal text-text-tertiary wrap-anywhere">
        {row.title}
      </span>
      {row.view ? (
        <span className="text-sm font-normal text-text">
          <AnswerValue view={row.view} />
        </span>
      ) : (
        <span className="text-sm font-normal text-text-tertiary">{t('answers.none')}</span>
      )}
      {row.isPublic ? (
        <span
          data-public-caption
          className="inline-flex items-center gap-1 text-xs font-normal text-text-tertiary"
        >
          <Eye aria-hidden size={14} />
          {t('answers.visible')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "Minhas respostas" on `/perfil` (12-14, D-584, UI-D-590, UI-D-591; PFORM-20): the member's own answers in
 * the admin's order, each public one marked "Visível no seu perfil", an unanswered optional question
 * reading "Sem resposta" (a conditional question that does not apply to her is omitted, not "Sem resposta").
 * More than four rows collapse behind a native `<details>` so the page does not
 * stretch. "Editar" opens the same completion screen the first answer used, and returns here.
 *
 * It loads its own data (`loadMyAnswers` never throws) so the page streams it in a `Suspense` of its
 * own: a slow or failing read never delays or blanks the base profile. With no active question it
 * renders nothing (the section is absent), nothing answered shows the shipped empty card, a failed read
 * the shipped error card with a retry that reloads the page.
 *
 * The page renders it for `role === 'member'` with the module on only; this component trusts that gate.
 */
export async function MyAnswersSection({ tenantName }: { tenantName: string }) {
  const t = await getTranslations('profileForm.profile');
  const result = await loadMyAnswers(answerWordsFrom(t as unknown as WordsTranslator));

  if (result.status === 'empty') return null;

  if (result.status === 'error') {
    return (
      <ProfileSection id="respostas" title={t('answers.title')}>
        <ProfileEmptyCard
          icon={CircleAlert}
          title={t('answers.error.title')}
          body={t('answers.error.body')}
          action={{
            href: '/perfil#respostas',
            label: t('answers.error.retry'),
            variant: 'outline',
          }}
        />
      </ProfileSection>
    );
  }

  // A conditional question the member never sees is omitted BEFORE the empty check and the collapse, so the
  // "Ver todas ({count})" count and the threshold count only the rows shown (D-634, UI-D-659). The card stays
  // flat, in the form's order, with no step headings (PU-6).
  const rows = result.rows.filter((row) => row.hidden !== true);

  // Nothing answered: the shipped empty card with the way to answer.
  if (rows.every((row) => row.view === null)) {
    return (
      <ProfileSection id="respostas" title={t('answers.title')}>
        <ProfileEmptyCard
          icon={ClipboardList}
          title={t('answers.empty.title')}
          body={t('answers.empty.body', { tenant: tenantName })}
          action={{ href: EDIT_ANSWERS_HREF, label: t('answers.empty.action'), variant: 'outline' }}
        />
      </ProfileSection>
    );
  }

  const head = rows.slice(0, VISIBLE_ANSWER_ROWS);
  const rest = rows.slice(VISIBLE_ANSWER_ROWS);

  return (
    <ProfileSection
      id="respostas"
      title={t('answers.title')}
      seeAll={{
        href: EDIT_ANSWERS_HREF,
        label: t('answers.edit'),
        ariaLabel: t('answers.editLabel'),
      }}
    >
      <Card className="mx-4 divide-y divide-border">
        {head.map((row) => (
          <AnswerRow key={row.questionId} row={row} t={t} />
        ))}
        {rest.length > 0 ? (
          <details data-answers-more className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-xs font-bold text-text-secondary transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">
                {t('answers.showAll', { count: rows.length })}
              </span>
              <span className="hidden group-open:inline">{t('answers.showLess')}</span>
            </summary>
            <div className="divide-y divide-border border-t border-border">
              {rest.map((row) => (
                <AnswerRow key={row.questionId} row={row} t={t} />
              ))}
            </div>
          </details>
        ) : null}
      </Card>
    </ProfileSection>
  );
}

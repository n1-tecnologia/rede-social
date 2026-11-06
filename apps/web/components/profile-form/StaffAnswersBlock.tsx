import type { StaffAnswers } from '@rede-social/contracts/profile-form';
import { Card, SectionTitle, StatusPill } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { answerView, answerWordsFrom, type WordsTranslator } from '@/lib/profile-form/answer-view';
import { isNotApplicable } from '@/lib/profile-form/visibility';
import { AnswerValue } from './AnswerValue';

type StaffRow = StaffAnswers['answers'][number];

/**
 * "Respostas do formulário" on a member's page, for the staff (12-14, D-593, D-588, UI-D-593; PFORM-19):
 * every active question in the admin's order (an unanswered one reads "Sem resposta", or "Não se aplica"
 * when it is a follow-up whose opener answer does not match, UI-D-659), then, only when
 * any exists, the sub-heading "Perguntas arquivadas" with the answers kept for archived questions. Two
 * staff-only markers say exactly what other members see: the neutral pill "Público no perfil" on a public
 * question, and "Arquivada" on an archived one (words, never colour alone).
 *
 * A member who answered nothing shows the one sentence "Esta pessoa ainda não respondeu o formulário."
 * The API sends the rows already ordered (active first, archived newest first); this block only splits
 * them, keeping each group's order. Every value goes through the one answer mapper.
 */
export async function StaffAnswersBlock({
  answers,
}: {
  answers: StaffAnswers['answers'];
  /** INERT in the RED commit of 12.2-14 Task 3: accepted and ignored until the GREEN commit reads it. */
  branches?: StaffAnswers['branches'];
}) {
  const t = await getTranslations('profileForm.profile');
  const words = answerWordsFrom(t as unknown as WordsTranslator);
  const rows = answers.map((answer) => ({
    answer,
    view: answer.answered ? answerView(answer, answer.value, words) : null,
  }));
  const rowsById = new Map(answers.map((answer) => [answer.questionId, answer]));
  const answeredAny = rows.some((row) => row.view !== null);
  const active = rows.filter((row) => row.answer.archivedAt === null);
  const archived = rows.filter((row) => row.answer.archivedAt !== null);

  const renderRow = ({
    answer,
    view,
  }: {
    answer: StaffRow;
    view: ReturnType<typeof answerView>;
  }) => (
    <div key={answer.questionId} className="flex min-w-0 flex-col gap-1 p-4">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-text-tertiary">
        <span className="break-words wrap-anywhere">{answer.title}</span>
        {answer.showOnProfile ? <StatusPill tone="neutral">{t('staff.public')}</StatusPill> : null}
        {answer.archivedAt !== null ? (
          <StatusPill tone="neutral">{t('staff.archived')}</StatusPill>
        ) : null}
      </span>
      {view ? (
        <span className="text-sm font-normal text-text">
          <AnswerValue view={view} />
        </span>
      ) : (
        // A follow-up whose opener answer does not match was never asked: it is not a skipped question (UI-D-659).
        <span className="text-sm font-normal text-text-tertiary">
          {isNotApplicable(answer, rowsById) ? t('staff.notApplicable') : t('answers.none')}
        </span>
      )}
    </div>
  );

  return (
    <section className="flex flex-col gap-3 px-4" data-member-answers="staff">
      <SectionTitle variant="micro">{t('staff.title')}</SectionTitle>
      <Card className="divide-y divide-border">
        {answeredAny ? (
          <>
            {active.map(renderRow)}
            {archived.length > 0 ? (
              <>
                <h3 className="px-4 pt-4 pb-2 text-xs font-bold text-text-secondary">
                  {t('staff.archivedTitle')}
                </h3>
                {archived.map(renderRow)}
              </>
            ) : null}
          </>
        ) : (
          <p className="p-4 text-sm font-normal text-text-tertiary">{t('staff.empty')}</p>
        )}
      </Card>
    </section>
  );
}

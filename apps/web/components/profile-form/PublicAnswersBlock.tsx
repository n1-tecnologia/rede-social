import type { PublicAnswers } from '@rede-social/contracts/profile-form';
import { Card, SectionTitle } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { answerView, answerWordsFrom, type WordsTranslator } from '@/lib/profile-form/answer-view';
import { AnswerValue } from './AnswerValue';

/**
 * "Sobre {name}" on another member's page (12-14, D-593, UI-D-592; PFORM-18): ONLY the questions the admin
 * made public that this person answered, as a description list (the question, then the answer). The API
 * sends nothing else (a strict payload with no e-mail, no flags and no private or archived row), and this
 * block renders only that payload, through the one answer mapper.
 *
 * **When there is nothing to show the block is absent** (no heading, no empty state), so the screen
 * stays the one it was before the form existed, byte for byte. A row whose stored shape does not fit its
 * type is skipped, never guessed. One row renders the same `dl`.
 */
export async function PublicAnswersBlock({
  name,
  answers,
}: {
  name: string;
  answers: PublicAnswers['answers'];
}) {
  const t = await getTranslations('profileForm.profile');
  const words = answerWordsFrom(t as unknown as WordsTranslator);
  const rows = answers.flatMap((answer) => {
    const view = answerView(answer, answer.value, words);
    return view ? [{ id: answer.questionId, title: answer.title, view }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <div className="px-4" data-member-answers="public">
      <Card className="p-4">
        <SectionTitle variant="micro">{t('public.title', { name })}</SectionTitle>
        <dl className="mt-3 grid gap-3">
          {rows.map((row) => (
            <div key={row.id} className="min-w-0">
              <dt className="break-words text-xs font-normal text-text-tertiary wrap-anywhere">
                {row.title}
              </dt>
              <dd className="m-0 text-sm font-normal text-text">
                <AnswerValue view={row.view} />
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

'use client';

import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { Card, SectionTitle, StatusPill } from '@rede-social/ui';
import { ChevronRight, Eye, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { typeNameKey } from '@/lib/profile-form/type-key';

export interface QuestionListProps {
  /** The ACTIVE questions in the order members see them (the API's order). */
  questions: AdminQuestion[];
  /** The most active questions a tenant may have. */
  limit: number;
  /**
   * Opens the question in the editor. Plan 16 supplies it (the editor sheet); until then a row is a
   * button that takes no click handler of its own.
   */
  onOpen?: (question: AdminQuestion) => void;
}

interface RowProps {
  question: AdminQuestion;
  position: number;
  total: number;
  onOpen?: (question: AdminQuestion) => void;
}

/**
 * One question of the builder (UI-D-566): the WHOLE row is one `button` (`min-h-11`) that opens the
 * editor, with the position, the title (three lines at most, `break-words`), a neutral type badge and, for
 * a public answer only, the "No perfil" pill, then the required state, the answer count and a lock
 * when answers exist. Colour and weight never carry a state alone: the required state, the position and
 * the count are words, and the position and the state are also in the accessible description.
 */
function QuestionRow({ question, position, total, onOpen }: RowProps) {
  const t = useTranslations('profileForm');
  const descriptionId = useId();
  const answered = question.answerCount > 0;
  const answers = t('admin.row.answers', { count: question.answerCount });
  const stateWord = question.required ? t('admin.row.required') : t('admin.row.optional');
  const where = t('admin.row.position', { position, total });
  // Colour and weight carry nothing alone: the position, the state, the count and the lock are words.
  const description = [where, stateWord, answers, answered ? t('admin.row.locked') : null]
    .filter((part): part is string => part !== null)
    .map((part) => `${part}.`)
    .join(' ');

  return (
    <li>
      <Card className="p-0">
        <button
          type="button"
          aria-label={t('admin.row.edit', { title: question.title })}
          aria-describedby={descriptionId}
          onClick={onOpen ? () => onOpen(question) : undefined}
          className="flex min-h-11 w-full items-start gap-3 p-4 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
          <span aria-hidden className="w-5 shrink-0 pt-px text-xs font-bold text-text-tertiary">
            {position}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="line-clamp-3 break-words text-sm font-bold text-text">
              {question.title}
            </span>
            <span className="flex flex-wrap gap-2">
              <StatusPill tone="neutral">{t(typeNameKey(question.type))}</StatusPill>
              {question.showOnProfile ? (
                <StatusPill tone="neutral">
                  <Eye aria-hidden size={12} />
                  {t('admin.row.onProfile')}
                </StatusPill>
              ) : null}
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-normal text-text-secondary">
              <span className={question.required ? 'font-bold text-text' : 'text-text-tertiary'}>
                {stateWord}
              </span>
              <span aria-hidden>·</span>
              <span>{answers}</span>
              {answered ? (
                <>
                  <Lock aria-hidden size={12} className="shrink-0" />
                  <span className="sr-only">{t('admin.row.locked')}</span>
                </>
              ) : null}
            </span>
          </span>
          <ChevronRight aria-hidden size={18} className="mt-0.5 shrink-0 text-text-tertiary" />
        </button>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </Card>
    </li>
  );
}

/**
 * The active list of the Perguntas tab (12-15, D-582, UI-D-565, UI-D-566): the "Perguntas ativas
 * (n)" micro-title and the rows in the admin's order, which is the order members see. The tab is read
 * once per request on the server and every write refreshes the page, so the list holds no client cache.
 * It shows aggregate counts only (PFORM-23): never an individual member's answer.
 */
export function QuestionList({ questions, limit, onOpen }: QuestionListProps) {
  const t = useTranslations('profileForm.admin.list');
  return (
    <section className="flex flex-col gap-3">
      {questions.length >= limit ? (
        <p data-limit-line className="text-xs font-normal text-text-tertiary">
          {t('limit', { max: limit })}
        </p>
      ) : null}
      <SectionTitle variant="micro">{t('title', { count: questions.length })}</SectionTitle>
      <ul className="flex flex-col gap-3">
        {questions.map((question, index) => (
          <QuestionRow
            key={question.id}
            question={question}
            position={index + 1}
            total={questions.length}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

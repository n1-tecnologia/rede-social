import type { ProfileFormSummary } from '@rede-social/contracts/profile-form';
import { Card } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { ProgressRing } from '@/components/profile/ProgressRing';
import { ExportAction } from './ExportDialog';

export interface FormSummaryCardProps {
  summary: ProfileFormSummary;
}

/** The share of members who are complete, rounded and held to 0..100 (`ProgressRing` clamps too). */
function percentOf(summary: ProfileFormSummary): number {
  if (summary.total <= 0) return 0;
  return Math.round((summary.complete / summary.total) * 100);
}

/**
 * The summary card of the Perguntas tab (12-15, D-584, D-585, UI-D-566): the shipped `ProgressRing` 64
 * beside "{done} de {total} membros completos" and one line of explanation, in the
 * `ProfileCompletenessCard` mould. "Completo" is every ACTIVE REQUIRED question answered; staff are in
 * neither number (the API's rule, shown as it comes).
 *
 * Two degenerate states hide the ring, because a percentage would mean nothing: no member yet ("Ainda
 * não há membros", checked first because it is the stronger fact) and no required question ("Nenhuma
 * pergunta obrigatória"). The page hides the card altogether when no question exists at all.
 *
 * Aggregates only (PFORM-23): the card receives counts, never an answer. The "Exportar respostas (CSV)"
 * button (12-17, D-595, UI-D-579) sits under the text and moves to the right edge from `md`; it is the one
 * door through which personal data leaves, through the logged API route, and it stays in both degenerate
 * states (disabled with its helper when no member exists). The text wraps and the card holds at 320px
 * (`min-w-0`, `break-words`).
 */
export function FormSummaryCard({ summary }: FormSummaryCardProps) {
  const t = useTranslations('profileForm.admin.summary');
  const noMembers = summary.total === 0;
  const noRequired = !noMembers && !summary.hasRequired;
  const pending = Math.max(0, summary.total - summary.complete);
  const percent = percentOf(summary);

  const title = noMembers
    ? t('noMembers')
    : noRequired
      ? t('noRequired')
      : t('title', { done: summary.complete, total: summary.total });
  const line = noMembers
    ? t('noMembersBody')
    : noRequired
      ? t('noRequiredBody')
      : pending > 0
        ? t('pending', { pending })
        : t('definition');

  return (
    <Card data-form-summary className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {noMembers || noRequired ? null : (
          <ProgressRing percent={percent} size={64} label={t('percent', { percent })} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="break-words text-sm font-bold text-text">{title}</h2>
          <p className="break-words text-xs font-normal text-text-secondary">{line}</p>
        </div>
      </div>
      <ExportAction memberTotal={summary.total} />
    </Card>
  );
}

import { cn, EmptyState } from '@rede-social/ui';
import { CalendarClock, CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SPAN_ALL } from './ownerGrid';

export type OwnerAreaStateProps =
  | {
      /** No snapshot yet (`owner`, UI-D-469), or this area's payload is missing or stale (`area`). */
      kind: 'preparing';
      scope: 'owner' | 'area';
    }
  | {
      /** The area's read failed (UI-D-479). */
      kind: 'error';
      /** The panel's current URL (the full query) with `#painel-do-dono`: "Tentar novamente" reloads it. */
      retryHref: string;
    };

/**
 * The owner area's own state card (08.7-01): `preparing` (`CalendarClock`, no action — never a
 * sample, a zero or a skeleton that never resolves) or `error` (`CircleAlert`, "Algo deu errado" and
 * an outline "Tentar novamente" that reloads the same screen). Either one fills the area slot only:
 * the panel's header and area row stay, and a failed read never reaches `app/error.tsx`.
 */
export async function OwnerAreaState(props: OwnerAreaStateProps) {
  const t = await getTranslations('dashboard');
  if (props.kind === 'preparing') {
    return (
      <EmptyState
        data-owner-area-state="preparing"
        variant="card"
        icon={CalendarClock}
        title={t(`report.preparing.${props.scope}.title`)}
        body={t(`report.preparing.${props.scope}.body`)}
        className={cn(SPAN_ALL)}
      />
    );
  }
  return (
    <EmptyState
      data-owner-area-state="error"
      variant="card"
      icon={CircleAlert}
      title={t('report.errors.title')}
      body={t('report.errors.area')}
      className={cn(SPAN_ALL)}
      action={
        <a
          href={props.retryHref}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
        >
          {t('report.errors.retry')}
        </a>
      }
    />
  );
}

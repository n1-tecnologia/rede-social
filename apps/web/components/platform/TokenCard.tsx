import type { TokenState, TokenSummary } from '@rede-social/contracts/projects';
import { Card, SectionTitle } from '@rede-social/ui';
import { CircleAlert, KeyRound, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TokenHowTo } from './TokenHowTo';
import { TokenPill } from './TokenPill';

export interface TokenCardProps {
  tenantId: string;
  /** The state, the typed expiry and the check time: nothing else about the token exists on this side. */
  token: TokenSummary;
  /** `YYYY-MM-DD`, computed on the server: the days left never come from a client clock. */
  today: string;
  /** "há 3 min" - computed on the server with `relativeFrom`; null when the token was never checked. */
  verifiedWhen: string | null;
}

/**
 * What a state's notice row looks like (UI-D-554): its catalog key and its tone. Válido and Não verificado
 * have no notice. Danger rows are alerts; Vencendo is the one warning ("will become a problem").
 */
const NOTICES = {
  expiring: { key: 'expiring', tone: 'warning' },
  expired: { key: 'expired', tone: 'danger' },
  invalid: { key: 'invalid', tone: 'danger' },
  no_permission: { key: 'noPermission', tone: 'danger' },
  org_mismatch: { key: 'orgMismatch', tone: 'danger' },
} as const;

type NoticeState = keyof typeof NOTICES;

function hasNotice(state: TokenState): state is NoticeState {
  return state in NOTICES;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days since the epoch of a `YYYY-MM-DD` string, by plain UTC arithmetic: no timezone enters. */
function epochDay(value: string | null): number | null {
  const match = DATE_ONLY.exec((value ?? '').trim());
  if (!match) return null;
  return Math.round(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000,
  );
}

const longDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** The typed date as "8 de novembro de 2026", read from the string itself so no timezone moves it a day. */
function typedLongDate(value: string | null): string | null {
  const day = epochDay(value);
  return day === null ? null : longDate.format(new Date(day * 86_400_000));
}

/**
 * The Token de acesso card of the Banco tab (09.4-16, UI-D-551, UI-D-554, CTK-34, CTK-36), customer
 * projects only. A Server Component fed STATE, never the token: the derived state, the expiry the operator
 * typed and when the last check ran. It shows the state's pill, the expiry line, when it was checked and a
 * plain notice that says what is lost and that the community keeps running; it never renders a prefix, a
 * length, the last characters or a "mostrar" control, because nothing of the kind reaches it (UI-D-561).
 *
 * A dead token is not an outage (UI-D-551): this card is the only place the state lives besides the header
 * and list pills, and it never changes the database pill.
 */
export function TokenCard({ token, today, verifiedWhen }: TokenCardProps) {
  const t = useTranslations('platform.database.token');
  const notice = hasNotice(token.state) ? NOTICES[token.state] : null;

  const expiryDate = typedLongDate(token.expiresAt);
  const daysLeft = (() => {
    const expiry = epochDay(token.expiresAt);
    const now = epochDay(today);
    return expiry === null || now === null ? null : expiry - now;
  })();
  const expiryLine =
    expiryDate === null
      ? t('noExpiry')
      : token.state === 'expiring' && daysLeft !== null
        ? t('expiresIn', { days: daysLeft, date: expiryDate })
        : token.state === 'expired' || (daysLeft !== null && daysLeft < 0)
          ? t('expiredOn', { date: expiryDate })
          : t('expiresOn', { date: expiryDate });

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <SectionTitle variant="micro">{t('title')}</SectionTitle>
      <div className="flex items-start gap-3">
        <KeyRound aria-hidden size={18} className="mt-0.5 shrink-0 text-text-secondary" />
        <p className="min-w-0 break-words text-sm text-text-secondary">{t('body')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <TokenPill state={token.state} />
          <span className="min-w-0 break-words text-xs text-text-tertiary">{expiryLine}</span>
        </div>
        <p className="break-words text-xs text-text-tertiary">
          {verifiedWhen ? t('verifiedAt', { when: verifiedWhen }) : t('neverChecked')}
        </p>
      </div>

      {notice ? (
        <div
          role={notice.tone === 'danger' ? 'alert' : undefined}
          data-notice={notice.key}
          className={
            notice.tone === 'danger'
              ? 'flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 px-3 py-3'
              : 'flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-3'
          }
        >
          {notice.tone === 'danger' ? (
            <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
          )}
          <p className="min-w-0 break-words text-xs text-text">{t(`notices.${notice.key}`)}</p>
        </div>
      ) : null}

      <TokenHowTo collapsible />
    </Card>
  );
}

'use client';

import { cn, Input } from '@rede-social/ui';
import { CalendarClock, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** What the two fields hold: the pasted token and the optional expiry as `YYYY-MM-DD`. */
export type ProjectTokenValues = { token: string; expiresAt: string };

/** Already-translated messages: the component takes errors, it never decides them. */
export type ProjectTokenErrors = Partial<Record<keyof ProjectTokenValues, string>>;

/**
 * The cap of the token input. It deliberately AMENDS the 256 of UI-D-550 (09.4-14, orchestrator
 * instruction): scoped tokens are JWT-shaped (RESEARCH A10), and a 256 cap would silently truncate a
 * real token. 4096 is the cap the existing access bodies use.
 */
const TOKEN_MAX_LENGTH = 4096;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The earliest and latest expiry a form may offer: tomorrow and one year from `today`, by plain UTC
 * date arithmetic (no clock, no timezone: the caller says what "today" is). A 29 February clamps to
 * 28 February of the next year. A `today` that is not a date yields no bounds.
 */
function expiryBounds(today: string): { min?: string; max?: string } {
  const match = DATE_ONLY.exec(today);
  if (!match) return {};
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  let max = Date.UTC(year + 1, month, day);
  if (new Date(max).getUTCMonth() !== month) max = Date.UTC(year + 1, month + 1, 0);
  return { min: toDate(Date.UTC(year, month, day + 1)), max: toDate(max) };
}

/**
 * The write-only token field and the optional expiry date of a customer project (09.4-14, UI-D-550,
 * UI-D-561, CTK-32). Props-only (the state lives with the caller), shared by the new-tenant wizard
 * and the "Substituir token" sheet, like `ProjectAccessFields`.
 *
 * Write-only by construction: `type="password"`, `autoComplete="off"`, `spellCheck={false}`,
 * `data-1p-ignore`, no show/hide control, never pre-filled and NO `name` a password manager could
 * recognise and offer to save. It renders exactly the values it is given and nothing else: never the
 * token, a prefix of it or its length, so a cleared value is an empty field. A long pasted token
 * scrolls inside its input; it is never wrapped or shown.
 */
export function ProjectTokenFields({
  values,
  onChange,
  errors = {},
  disabled = false,
  today,
  className,
}: {
  values: ProjectTokenValues;
  onChange: (next: ProjectTokenValues) => void;
  errors?: ProjectTokenErrors;
  disabled?: boolean;
  /** `YYYY-MM-DD`, from the server: the bounds of the date field are computed from it. */
  today: string;
  className?: string;
}) {
  const t = useTranslations('platform.wizard.project');
  const { min, max } = expiryBounds(today);

  return (
    <div data-project-token className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-2">
        <Input
          id="projectToken"
          type="password"
          label={t('token.label')}
          icon={KeyRound}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          maxLength={TOKEN_MAX_LENGTH}
          disabled={disabled}
          value={values.token}
          onChange={(event) => onChange({ ...values, token: event.target.value })}
          error={errors.token}
        />
        <p className="text-xs text-text-tertiary">{t('token.helper')}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Input
          id="projectTokenExpiresAt"
          type="date"
          label={t('expiry.label')}
          icon={CalendarClock}
          min={min}
          max={max}
          disabled={disabled}
          value={values.expiresAt}
          onChange={(event) => onChange({ ...values, expiresAt: event.target.value })}
          error={errors.expiresAt}
        />
        <p className="text-xs text-text-tertiary">{t('expiry.helper')}</p>
      </div>
    </div>
  );
}

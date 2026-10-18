import { StatusPill } from '@rede-social/ui';

/**
 * The one "Em breve" state of both panels (08.7-03, D-455, D-456, D-458, UI-D-466, UI-D-467): a
 * metric the app does not measure yet shows no number, no zero, no dash and no sample, in one of
 * four forms worded by ONE family of strings (`dashboard.report.comingSoon.*`):
 * - (a) tile: a KPI card with "Em breve" in its value slot and "Medição a caminho" as its note — the
 *   member `KpiCard missing` and the module `KpiCard variant="missing"`, fed by `comingSoonCopy`;
 * - (b) line: `ComingSoonPill` in place of a value inside a real card;
 * - (c) block: `ComingSoonBlock`, a whole block with no source (no ghost chart, axis or bar);
 * - (d) list: an "Em breve" number never opens (its card is never linked).
 * The pill is neutral (`StatusPill tone="neutral"`): it never looks like a call to action or an
 * alarm. Props only; the strings arrive from the catalog.
 */

/** The `dashboard.report` translator, as both panels receive it. */
export type ComingSoonT = (key: string, values?: Record<string, string | number>) => string;

/** The family's strings, read once: the tile value, the tile note, the block note, the compact line. */
export function comingSoonCopy(tr: ComingSoonT) {
  return {
    value: tr('comingSoon.value'),
    note: tr('comingSoon.note'),
    block: tr('comingSoon.block'),
    inline: (metric: string) => tr('comingSoon.inline', { metric }),
  };
}

/** Form (b): the neutral "Em breve" pill, in place of a missing line's value (and UI-D-478). */
export function ComingSoonPill({ label, className }: { label: string; className?: string }) {
  return (
    <StatusPill tone="neutral" data-coming-soon className={className}>
      {label}
    </StatusPill>
  );
}

/**
 * Form (c): a whole block with no source — one dashed card, transparent ground, no shadow, the
 * block's title with the pill on its right (when titled), then the block note. It keeps its place
 * and never expands.
 */
export function ComingSoonBlock({
  title,
  label,
  note,
}: {
  title?: string;
  label: string;
  note: string;
}) {
  return (
    <div
      data-coming-soon-block
      className="flex flex-col gap-2 rounded-2xl border border-dashed border-border-secondary bg-transparent p-4"
    >
      {title ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 text-sm font-bold text-text [overflow-wrap:anywhere]">{title}</p>
          <ComingSoonPill label={label} className="shrink-0" />
        </div>
      ) : (
        <ComingSoonPill label={label} className="self-start" />
      )}
      <p className="text-xs font-normal text-text-tertiary">{note}</p>
    </div>
  );
}

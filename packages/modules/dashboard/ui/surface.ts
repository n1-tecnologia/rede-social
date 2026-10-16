/**
 * The panels' card surface, one for every block (KPIs, charts, bars, tables, lists): a 16px radius,
 * a hairline border and a soft shadow in the ink the app's own cards use. Tokens only otherwise.
 */
export const SURFACE =
  'rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(22,35,59,0.04),0_6px_18px_-10px_rgba(22,35,59,0.1)]';

/**
 * A surface's entrance: it waits hidden and rises in when it scrolls into view (`DashMotion`), after
 * the delay its `[data-dash-stagger]` parent hands it; what moves inside it starts then. Styled in
 * `@rede-social/ui`'s tokens.css; shown at once under reduced motion or without script.
 */
export const RISE = 'dash-reveal';

/**
 * A linked surface's hover, inside a `group/link` (the whole card a link): it lifts a little, with a
 * brand edge and glow. `KpiCard` takes it with `linked`; a host's own card adds it itself.
 */
export const LIFT =
  'group-hover/link:-translate-y-0.5 group-hover/link:border-brand/30 group-hover/link:shadow-lg group-hover/link:shadow-brand/10';

import { brandStyleVars, deriveBrandColors } from '@rede-social/contracts/branding';
import { Button, Card, cn } from '@rede-social/ui';
import { Bell, Home, User } from 'lucide-react';
import type { ReactNode } from 'react';

export type BrandPreviewLabels = {
  /** Caption of the light frame ("Claro"). */
  light: string;
  /** Caption of the dark frame ("Escuro"). */
  dark: string;
  /** `aria-label` of the light frame. */
  lightAria: string;
  /** `aria-label` of the dark frame. */
  darkAria: string;
  /** The mini login CTA ("Entrar"). */
  login: string;
};

export type BrandPreviewProps = {
  /** The two D-25 source colours as last validly typed; every other colour is derived here. */
  colors: { primary: string; secondary: string };
  /** Shown as text in the mini TopBar and the mini body when there is no logo (D-26). */
  displayName: string;
  /** Rendered as-is through `<img>`; `null` → the display name text (D-26). */
  logoUrl: string | null;
  labels: BrandPreviewLabels;
  className?: string;
  /** Readout slot rendered once below the two frames (the panel puts `ContrastFeedback` here). */
  children?: ReactNode;
};

/**
 * Kernel brand preview (UI-SPEC `BrandPreview`, D-25/D-26/D-41): two `[data-brand-scope]` mini-shells
 * — light and dark, 200×140, overflow-hidden — with the brand variables applied INLINE through
 * `brandStyleVars(deriveBrandColors(colors))`, each mirroring 02-07's TopBar/BottomNav geometry at
 * roughly 55 %: a mini TopBar (logo or display name + bell + avatar dot), a mini `Button
 * variant="brand"` login CTA and a mini BottomNav pill with the active chip.
 *
 * Presentational and server-safe: no hooks, every string a prop, no import of the kernel's server or
 * database code (Biome override on `packages/core/ui/**`). It renders ONLY the colours, logo and
 * display name it receives — never a Rede Social mark and never the neutral fallback when colours are
 * given — so the platform panel (02-14) and Phase 8's `admin_tenant` editor reuse it unchanged. The
 * brand aliases (`bg-brand`, `text-on-brand`, …) resolve inside each frame because `tokens.css`
 * re-declares them on `[data-brand-scope]` (Layer 1b).
 */
export function BrandPreview({
  colors,
  displayName,
  logoUrl,
  labels,
  className,
  children,
}: BrandPreviewProps) {
  const derived = deriveBrandColors(colors);
  const vars = brandStyleVars({ colors: derived });

  const frameClass =
    'relative mx-auto h-[140px] w-[200px] overflow-hidden rounded-xl border border-border bg-bg text-text';

  /** The inert mini-shell content (identical in both frames; the frame's theme scope does the rest). */
  const shell = (
    <div inert aria-hidden="true" className="h-full">
      {/* mini TopBar (02-07 geometry: h-12 px-4 → h-7 px-2) */}
      <div className="flex h-7 items-center justify-between border-b border-border bg-bg-secondary px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {logoUrl ? (
            // biome-ignore lint/performance/noImgElement: D-26 — the customer's logo is rendered as-is (any format, any origin), never re-encoded.
            <img src={logoUrl} alt={displayName} className="h-4 max-w-[80px] object-contain" />
          ) : (
            <span className="truncate text-[11px] font-bold tracking-tight">{displayName}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-text-secondary">
          <Bell size={12} strokeWidth={1.7} aria-hidden />
          <span className="h-3.5 w-3.5 rounded-full bg-bg-tertiary" />
        </div>
      </div>
      {/* mini body: the login screen's identity + CTA */}
      <div className="flex flex-col items-center gap-2 px-3 pt-3">
        {logoUrl ? (
          // biome-ignore lint/performance/noImgElement: D-26 — see above.
          <img src={logoUrl} alt="" className="h-6 max-w-[120px] object-contain" />
        ) : (
          <span className="max-w-full truncate text-xs font-bold">{displayName}</span>
        )}
        <Button variant="brand" size="sm" type="button" tabIndex={-1}>
          {labels.login}
        </Button>
      </div>
      {/* mini BottomNav pill with the active chip */}
      <div className="glass-bar absolute inset-x-6 bottom-1.5 flex h-7 items-center justify-around rounded-full px-1">
        <span className="grid h-5 w-7 place-items-center rounded-full bg-[var(--theme-chip)] text-brand">
          <Home size={12} strokeWidth={2.3} aria-hidden />
        </span>
        <span className="grid h-5 w-7 place-items-center text-text-tertiary">
          <User size={12} strokeWidth={1.7} aria-hidden />
        </span>
      </div>
    </div>
  );

  return (
    <Card className={cn('p-4', className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="m-0 flex min-w-0 flex-col">
          <figcaption className="mb-2 text-xs font-bold text-text-tertiary">
            {labels.light}
          </figcaption>
          <div
            data-brand-scope
            data-theme="light"
            role="img"
            aria-label={labels.lightAria}
            style={vars}
            className={frameClass}
          >
            {shell}
          </div>
        </figure>
        <figure className="m-0 flex min-w-0 flex-col">
          <figcaption className="mb-2 text-xs font-bold text-text-tertiary">
            {labels.dark}
          </figcaption>
          <div
            data-brand-scope
            data-theme="dark"
            role="img"
            aria-label={labels.darkAria}
            style={vars}
            className={frameClass}
          >
            {shell}
          </div>
        </figure>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}

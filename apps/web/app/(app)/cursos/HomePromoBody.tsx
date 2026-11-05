import { ArrowRight, Sparkles } from 'lucide-react';
import type { HomePromoView } from '@/lib/courses-home-view';

/**
 * The promotion's invitation, centred over the collage (`HomePromo`): the eyebrow, the title (the
 * section's name), the line, the chips and ONE white CTA. Its own module, with no server reads, so
 * the administrator's picker (`HomePromoChoice`, a client component) draws the very same words for
 * the product it picks.
 */
export function HomePromoBody({ view }: { view: HomePromoView }) {
  return (
    <div className="relative z-10 m-auto flex w-full max-w-md flex-col items-center px-6 py-12 text-center">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
        <Sparkles aria-hidden size={13} className="shrink-0" />
        {view.eyebrow}
      </span>
      <h2
        id="courses-home-promo-title"
        className="ms-title-font mt-4 break-words text-3xl font-medium leading-tight tracking-tight text-white lg:text-[34px]"
      >
        {view.title}
      </h2>
      <p className="mt-3 text-sm font-normal leading-relaxed text-white/70 lg:text-[15px]">
        {view.body}
      </p>
      {view.chips.length > 0 ? (
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {view.chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/85 backdrop-blur-sm"
            >
              {chip}
            </li>
          ))}
        </ul>
      ) : null}
      <a
        href={view.cta.href}
        data-testid="courses-home-promo-cta"
        className="mt-6 inline-flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-black transition-[scale,opacity] hover:opacity-95 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none"
      >
        {view.cta.label}
        <ArrowRight aria-hidden size={16} className="shrink-0" />
      </a>
    </div>
  );
}

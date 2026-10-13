import { Card } from '@rede-social/ui';
import { Circle, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { clampPercent, ProgressRing } from './ProgressRing';

/** One item of the checklist ("Foto", "Bio", "Instagram"). */
export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
  /** The state in words for assistive tech only ("preenchido", "pendente"); the icon shows it. */
  stateLabel: string;
}

export interface ProfileCompletenessCardProps {
  /** 0 to 100: the ring's arc; at 100 the card turns compact. */
  percent: number;
  /** The ring's centred text, from the catalog ("33%"). */
  percentLabel: string;
  /** "Complete seu perfil", or "Perfil completo" at 100. */
  title: string;
  /** Already formatted by the host ("1 de 3 itens preenchidos"). */
  progress: string;
  items: readonly CompletenessItem[];
  /** "Completar perfil" → `/perfil/editar`; absent or `null`, no button (the platform preview). */
  cta?: { href: string; label: string } | null;
}

/**
 * The "Complete seu perfil" warning of `/perfil` (2026-10-12): a 64px `ProgressRing` beside
 * the title, the "{done} de {total}" line, the checklist (a check in the success ink for a filled
 * item, an empty circle for a pending one, with the state in words for assistive tech) and the
 * tenant-button CTA that opens the edit form.
 *
 * **Complete, it turns compact**: at 100 the checklist and the CTA go, and the ring, the title and
 * the line stay, so a finished profile takes one quiet row instead of a to-do list. Since 2026-10-13
 * `/perfil` shows the card only while something is missing (it is a warning there); the compact
 * form stays for a host that shows a finished profile.
 *
 * Synchronous and props only (it waits for no data, so the top of the screen never jumps); it ships
 * no words. The title is an `h3`: on `/perfil` the card sits under the person's name, the hero's `h2`.
 */
export function ProfileCompletenessCard({
  percent,
  percentLabel,
  title,
  progress,
  items,
  cta = null,
}: ProfileCompletenessCardProps) {
  const complete = clampPercent(percent) >= 100;
  return (
    <Card
      data-profile-completeness
      data-complete={complete || undefined}
      className="flex items-center gap-4 p-4"
    >
      <ProgressRing percent={percent} size={64} label={percentLabel} />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-text">{title}</h3>
        <p className="mt-0.5 text-xs text-text-secondary">{progress}</p>
        {complete ? null : (
          <>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {items.map((item) => (
                <li
                  key={item.key}
                  data-done={item.done || undefined}
                  className="flex items-center gap-1 text-xs text-text-secondary"
                >
                  {item.done ? (
                    <CircleCheck aria-hidden size={14} className="shrink-0 text-success" />
                  ) : (
                    <Circle aria-hidden size={14} className="shrink-0 text-text-tertiary" />
                  )}
                  <span>{item.label}</span>
                  <span className="sr-only">{item.stateLabel}</span>
                </li>
              ))}
            </ul>
            {cta ? (
              <Link
                href={cta.href}
                data-profile-completeness-cta
                className="mt-3 inline-flex h-9 items-center rounded-xl bg-button bg-(image:--button-image) px-4 text-xs font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {cta.label}
              </Link>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

import { Card } from '@rede-social/ui';
import { type LucideIcon, TriangleAlert } from 'lucide-react';

/**
 * The suspended-host answer on the public forms (D-32, UI-SPEC "Suspended host: Card ... form hidden"):
 * `/entrar` and `/cadastro` render this INSTEAD of their form. Copy is the `unavailable` namespace,
 * interpolated by the caller; nothing tenant-specific beyond the host brand painted by the layout.
 *
 * 09.2-21 (UI-D-542): the same card also stands in for the form of a community being updated or
 * prepared, with that state's glyph through the optional `icon` (default `TriangleAlert`, so every
 * other call renders exactly as before).
 */
export function UnavailableCard({
  title,
  body,
  icon: Icon = TriangleAlert,
}: {
  title: string;
  body: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <Icon aria-hidden size={28} className="text-warning" />
      <h2 className="text-base font-bold text-text">{title}</h2>
      <p className="text-sm text-text-secondary">{body}</p>
    </Card>
  );
}

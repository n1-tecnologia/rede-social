import { Card } from '@rede-social/ui';
import { TriangleAlert } from 'lucide-react';

/**
 * The suspended-host answer on the public forms (D-32, UI-SPEC "Suspended host: Card ... form hidden"):
 * `/entrar` and `/cadastro` render this INSTEAD of their form. Copy is the `unavailable` namespace,
 * interpolated by the caller; nothing tenant-specific beyond the host brand painted by the layout.
 */
export function UnavailableCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <TriangleAlert aria-hidden size={28} className="text-warning" />
      <h2 className="text-base font-bold text-text">{title}</h2>
      <p className="text-sm text-text-secondary">{body}</p>
    </Card>
  );
}

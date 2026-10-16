import { Card } from '@rede-social/ui';
import { SURFACE } from './surface';
import { type LabelTone, ToneLabel } from './ToneLabel';

export interface AttentionItem {
  id: string;
  tone: LabelTone;
  /** The short pill text ("84%", "26h", "Expirado"). */
  tag: string;
  title: string;
  detail?: string;
}

export interface AttentionListProps {
  items: readonly AttentionItem[];
}

/**
 * What needs someone now, in a single card: each row is a tone label (icon + text), the bold title and
 * a secondary detail. Read-only in the module: a host that makes rows navigable wraps them itself.
 */
export function AttentionList({ items }: AttentionListProps) {
  return (
    <Card className={SURFACE}>
      <ul className="divide-y divide-divider">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 p-4">
            <ToneLabel tone={item.tone} className="shrink-0">
              {item.tag}
            </ToneLabel>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <span className="text-sm font-bold text-text">{item.title}</span>
              {item.detail ? (
                <span className="text-xs text-text-secondary">{item.detail}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

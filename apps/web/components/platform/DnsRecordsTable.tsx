'use client';

import { IconButton, useToast } from '@tria/ui';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One DNS instruction as the card renders it — declared HERE because client files never import the
 * `@tria/contracts` barrel; `lib/platform-domains.ts` maps the server-parsed `dnsRecordSchema`
 * objects into this shape.
 */
export type DnsRecordView = {
  type: 'CNAME' | 'A' | 'TXT';
  name: string;
  value: string;
  purpose: 'routing' | 'ownership';
};

export interface DnsRecordsTableLabels {
  title: string;
  type: string;
  name: string;
  value: string;
  copy: string;
  copied: string;
  copyError: string;
}

export interface DnsRecordsTableProps {
  records: DnsRecordView[];
  labels: DnsRecordsTableLabels;
}

const COPIED_MS = 1500;

/**
 * The 44×44 copy control of one Valor cell (T-02-95): the string it writes to the clipboard is the
 * `value` PROP it received from the server-parsed record — never text read back from the DOM, never
 * user input. Success swaps the glyph for 1.5 s and announces through the table's live region; a
 * clipboard failure (no API, permission denied) ends in the error toast and never throws.
 */
function CopyValueButton({
  value,
  label,
  onCopied,
  onFailed,
}: {
  value: string;
  label: string;
  onCopied: () => void;
  onFailed: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      onCopied();
    } catch {
      onFailed();
    }
  };

  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={label}
      size={20}
      onClick={copy}
      className={copied ? 'text-success' : 'text-text-secondary'}
    />
  );
}

/**
 * Tipo · Nome · Valor for the DNS records a pending host still needs (D-34, mockup
 * `tenant-page-dominios`). Desktop: a three-column table; below `md`: stacked label/value blocks per
 * record so a long TXT value never forces a horizontal scroll (E16/overflow). Every record string is
 * a React TEXT child — no raw-HTML injection, nothing from a record reaches an `href`, `src` or
 * `style` (T-02-56 / T-02-90). Rows are keyed by `type|name`, never by index (TENANT-07/ordering).
 */
export function DnsRecordsTable({ records, labels }: DnsRecordsTableProps) {
  const toast = useToast();
  const [announcement, setAnnouncement] = useState('');

  const copied = useCallback(() => {
    setAnnouncement('');
    // A fresh string on every success so repeated copies are announced again.
    requestAnimationFrame(() => setAnnouncement(labels.copied));
    toast.show({ tone: 'success', message: labels.copied });
  }, [labels.copied, toast]);
  const failed = useCallback(() => {
    toast.show({ tone: 'error', message: labels.copyError });
  }, [labels.copyError, toast]);

  const headerCell =
    'px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-tertiary';

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border">
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <table className="hidden w-full md:table" aria-label={labels.title}>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={headerCell}>
              {labels.type}
            </th>
            <th scope="col" className={headerCell}>
              {labels.name}
            </th>
            <th scope="col" className={headerCell}>
              {labels.value}
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={`${record.type}|${record.name}`}
              className="border-b border-divider align-top last:border-0"
            >
              <td className="px-4 py-3 text-xs font-bold tabular-nums text-text">{record.type}</td>
              <td className="break-all px-4 py-3 text-sm text-text">{record.name}</td>
              <td className="px-4 py-2 text-sm text-text">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-all pt-1.5">{record.value}</span>
                  <CopyValueButton
                    value={record.value}
                    label={labels.copy}
                    onCopied={copied}
                    onFailed={failed}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col md:hidden" aria-label={labels.title}>
        {records.map((record) => (
          <li
            key={`${record.type}|${record.name}`}
            className="flex min-w-0 flex-col gap-2 border-b border-divider px-4 py-3 last:border-0"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                {labels.type}
              </span>
              <span className="text-xs font-bold tabular-nums text-text">{record.type}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                {labels.name}
              </span>
              <span className="break-all text-sm text-text">{record.name}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                {labels.value}
              </span>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-all pt-1.5 text-sm text-text">{record.value}</span>
                <CopyValueButton
                  value={record.value}
                  label={labels.copy}
                  onCopied={copied}
                  onFailed={failed}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

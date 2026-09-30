/**
 * The day separator inside the message log (UI-D-259): a centred pill reading "Hoje", "Ontem" or a
 * formatted date. The host computes the label from server-provided tenant-local day keys, so no
 * client clock is read here. Neutral by design (not an accent item). Props-only: no words.
 */
export interface DaySeparatorProps {
  label: string;
}

export function DaySeparator({ label }: DaySeparatorProps) {
  return (
    <li data-chat-day className="flex justify-center">
      <span className="self-center rounded-full bg-bg-tertiary px-3 py-1 text-xs font-bold text-text-secondary">
        {label}
      </span>
    </li>
  );
}

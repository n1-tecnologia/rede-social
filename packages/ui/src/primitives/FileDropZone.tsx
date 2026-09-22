'use client';

import { type LucideIcon, Upload } from 'lucide-react';
import { type ChangeEvent, type DragEvent, useId, useState } from 'react';
import { cn } from '../cn';

export type FileDropZoneState = 'idle' | 'progress' | 'processing';

export interface FileDropZoneProps {
  /** Explicit id for the hidden file input (the caption is its label). */
  id?: string;
  /** Called with the accepted file (click or drop). */
  onFile: (file: File) => void;
  /** Called when a file is refused by `accept` or `maxBytes`. */
  onReject?: (reason: 'type' | 'size', file: File) => void;
  /** MIME types / extensions, as on `<input accept>`. */
  accept?: string;
  maxBytes?: number;
  /**
   * Whether the zone itself refuses a file that `accept`/`maxBytes` would exclude (default `true`).
   *
   * Set `false` when the CALLER owns the verdict: a photo zone re-encodes an over-cap or
   * phone-format image in the browser instead of refusing it (R-12), and a drop must reach that
   * decision. `accept` still narrows the OS picker either way.
   */
  screen?: boolean;
  state?: FileDropZoneState;
  /** 0–100 while `state === 'progress'`. */
  progress?: number;
  /** Error message slot (rendered with `role="alert"`). */
  error?: string;
  icon?: LucideIcon;
  labels: {
    /** Idle caption, e.g. "Arraste o logo ou toque para escolher". */
    caption: string;
    /** Caption while uploading; receives the percentage. */
    progress: (percent: number) => string;
    /** Caption while the server processes the file. */
    processing: string;
  };
  disabled?: boolean;
  className?: string;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const rules = accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** Dashed drop zone for a single file with drag-over highlight, progress bar and error slot. */
export function FileDropZone({
  id,
  onFile,
  onReject,
  accept,
  maxBytes,
  screen = true,
  state = 'idle',
  progress = 0,
  error,
  icon: Icon = Upload,
  labels,
  disabled = false,
  className,
}: FileDropZoneProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-file`;
  const errorId = `${inputId}-error`;
  const [dragOver, setDragOver] = useState(false);
  const busy = state !== 'idle';
  const inert = disabled || busy;

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (screen) {
      if (!matchesAccept(file, accept)) return onReject?.('type', file);
      if (maxBytes !== undefined && file.size > maxBytes) return onReject?.('size', file);
    }
    onFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (inert) return;
    handleFile(event.dataTransfer.files[0]);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  const caption =
    state === 'progress'
      ? labels.progress(percent)
      : state === 'processing'
        ? labels.processing
        : labels.caption;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <section
        aria-label={caption}
        onDragOver={(event) => {
          event.preventDefault();
          if (!inert) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-busy={busy || undefined}
        className={cn(
          'relative flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-4 text-center transition-colors',
          dragOver ? 'border-brand bg-brand-soft' : 'border-border-secondary bg-bg-secondary/50',
          !inert && 'hover:bg-card-hover',
          inert && 'cursor-not-allowed opacity-70',
        )}
      >
        <Icon aria-hidden size={40} className={cn('text-text-tertiary', busy && 'animate-pulse')} />
        <label
          htmlFor={inputId}
          className={cn('text-sm text-text-secondary', !inert && 'cursor-pointer')}
        >
          {caption}
        </label>
        <input
          id={inputId}
          type="file"
          accept={accept}
          disabled={inert}
          onChange={onChange}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="sr-only"
        />
        {state === 'progress' ? (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="absolute inset-x-4 bottom-3 h-1 overflow-hidden rounded-full bg-bg-tertiary"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
      </section>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

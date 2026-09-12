'use client';

import { useRef } from 'react';

/**
 * The tenant's rules as a bottom sheet (D-03). A native `<dialog>`: `Escape` closes it for free, the
 * backdrop and focus trap come from the platform, and no design-system dependency is needed in Phase 1.
 */
export function RulesSheet({
  trigger,
  title,
  close,
  rulesText,
}: {
  trigger: string;
  title: string;
  close: string;
  rulesText: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const paragraphs = rulesText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        style={{
          position: 'fixed',
          bottom: 0,
          top: 'auto',
          width: '100%',
          maxWidth: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          border: 0,
          borderRadius: '1rem 1rem 0 0',
          padding: '1.25rem',
        }}
      >
        <h2>{title}</h2>
        {paragraphs.map((block) => (
          <p key={block.slice(0, 48)}>{block}</p>
        ))}
        <button type="button" onClick={() => ref.current?.close()}>
          {close}
        </button>
      </dialog>
    </>
  );
}

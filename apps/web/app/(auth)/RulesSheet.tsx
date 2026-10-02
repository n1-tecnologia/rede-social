'use client';

import { BottomSheet, Button, useMediaQuery } from '@rede-social/ui';
import { useState } from 'react';
import { RulesText } from '@/components/rules/RulesText';

/**
 * The tenant's rules behind the "ver regras" trigger (D-03), on `@rede-social/ui` `BottomSheet`: a sheet on
 * phones, the centred `max-w-[480px]` card from `md` up (`desktopCard`). The sheet owns
 * `role="dialog"`, `aria-modal`, Escape, backdrop tap and the focus trap (02-02); the text scrolls
 * inside it (80% of `--screen-h`). Shared by `/cadastro` and `/aceitar-convite` (02-10). The paragraphs
 * render through the shared `RulesText` (08-07, UI-D-281), the same renderer as the admin's preview.
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
  const [open, setOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 768px)');
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left text-sm font-bold text-brand"
      >
        {trigger}
      </button>
      <BottomSheet open={open} title={title} onClose={() => setOpen(false)} desktopCard={desktop}>
        <div className="flex flex-col gap-4">
          <RulesText rulesText={rulesText} />
          <Button type="button" variant="secondary" fullWidth onClick={() => setOpen(false)}>
            {close}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

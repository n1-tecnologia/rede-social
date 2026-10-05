import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 2026-10-03 (review F1) — the filled call-to-action buttons written by hand, outside the Button
 * primitive and LinkButton, read the BUTTON colour (`bg-button text-on-button`), never the primary
 * (`bg-brand text-on-brand`). Without a button colour both resolve to the same paint, so a site
 * copied back from an old snippet would look right today and silently ignore the tenant's button
 * colour once it is set: no rendering test can see it, so the sources are read here.
 *
 * Each site is its file and a fragment of its class list that is unique in that file. Chips,
 * switches, tabs, the "Vou" pill, chat bubbles and the focus ring stay on the primary on purpose
 * and are not listed.
 *
 * The gradient button (2026-10-03, second round) paints an image over that colour: every site
 * also carries `bg-(image:--button-image)` (`none` unless the gradient is set, so nothing changes
 * without it), and the gradient hovers exactly where the colour does: a site with
 * `hover:bg-button-hover` also has `hover:bg-(image:--button-image-hover)`, and one without it
 * (the FABs, the send buttons, the opacity hover) has neither, as the solid button there.
 */

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const SITES = [
  [
    'apps/web/components/platform/preview/TenantAppPreview.tsx',
    'grid h-14 w-14 place-items-center rounded-full',
  ],
  [
    'apps/web/components/platform/preview/TenantAppPreview.tsx',
    'shrink-0 items-center justify-center gap-1.5 rounded-xl',
  ],
  [
    'apps/web/app/(app)/comunidades/CommunitiesList.tsx',
    'inline-flex h-11 items-center justify-center rounded-xl',
  ],
  [
    'apps/web/app/(app)/comunidades/page.tsx',
    'shrink-0 items-center justify-center gap-1.5 rounded-xl',
  ],
  [
    'apps/web/app/(app)/eventos/EventsSections.tsx',
    'inline-flex h-11 items-center justify-center gap-2 rounded-xl',
  ],
  [
    'apps/web/app/(app)/eventos/page.tsx',
    'shrink-0 items-center justify-center gap-1.5 rounded-xl',
  ],
  [
    'apps/web/app/(app)/stories/meus/StoryHistoryList.tsx',
    'inline-flex h-11 items-center justify-center rounded-xl',
  ],
  [
    'apps/web/app/(app)/suporte/loading.tsx',
    'h-11 w-11 shrink-0 items-center justify-center rounded-full',
  ],
  [
    'apps/web/app/(app)/suporte/[conversationId]/loading.tsx',
    'h-11 w-11 shrink-0 items-center justify-center rounded-full',
  ],
  [
    'packages/modules/chat/ui/ChatComposer.tsx',
    'h-11 w-11 shrink-0 items-center justify-center rounded-full',
  ],
  ['packages/modules/feed/ui/ComposeFab.tsx', 'grid h-14 w-14 place-items-center rounded-full'],
  [
    'packages/modules/feed/ui/FeedList.tsx',
    'inline-flex h-11 items-center justify-center rounded-xl',
  ],
] as const;

describe('filled CTAs written by hand read the button colour', () => {
  it.each(SITES)('%s :: %s', (file, fragment) => {
    const lines = readFileSync(resolve(repo, file), 'utf8')
      .split('\n')
      .filter((line) => line.includes(fragment));
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    const tokens = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')).split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(['bg-button', 'bg-(image:--button-image)', 'text-on-button']),
    );
    for (const legacy of ['bg-brand', 'text-on-brand', 'hover:bg-brand-hover']) {
      expect(tokens).not.toContain(legacy);
    }
    expect(tokens.includes('hover:bg-(image:--button-image-hover)')).toBe(
      tokens.includes('hover:bg-button-hover'),
    );
  });
});

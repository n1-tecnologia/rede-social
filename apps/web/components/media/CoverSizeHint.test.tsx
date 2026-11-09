// @vitest-environment happy-dom
import path from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { COVER_SIZES, type CoverKind } from '@/lib/cover-sizes';
import { CoverSizeHint } from './CoverSizeHint';

/**
 * 2026-10-23 — the ideal size under every cover field, on the real catalog: the numbers unformatted
 * (never "1.600"), the shape named, the orientation's glyph, and the keep-it-centred line only for a
 * cover the app also crops to another shape.
 */

// happy-dom replaces `URL`, so the catalog is resolved from the package root (vitest's cwd).
const messages = loadMessages(path.resolve(process.cwd(), 'messages/pt-BR'));

const Provider = NextIntlClientProvider as unknown as (props: {
  locale: string;
  messages: unknown;
  timeZone: string;
  children?: ReactNode;
}) => ReactNode;

function hint(kind: CoverKind) {
  const { container } = render(
    <Provider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <CoverSizeHint kind={kind} />
    </Provider>,
  );
  return container.querySelector(`[data-cover-size="${kind}"]`) as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe('CoverSizeHint', () => {
  it('prints the course’s ideal size with plain numbers and the centred-subject line', () => {
    const node = hint('course');
    expect(node.textContent).toContain('Medida ideal: 1600 × 1200 px (4:3)');
    expect(node.textContent).not.toContain('1.600');
    expect(node.textContent).toContain(
      'Deixe o principal no centro: a capa aparece vertical no catálogo e horizontal no topo do curso.',
    );
  });

  it.each(Object.entries(COVER_SIZES))(
    '%s: the size, the shape and the right glyph',
    (kind, size) => {
      const node = hint(kind as CoverKind);
      expect(node.textContent).toContain(
        `Medida ideal: ${size.width} × ${size.height} px (${size.ratio})`,
      );
      const glyph =
        size.width > size.height
          ? 'lucide-rectangle-horizontal'
          : size.width < size.height
            ? 'lucide-rectangle-vertical'
            : 'lucide-square';
      expect(node.querySelector(`svg.${glyph}`)).not.toBeNull();
      // The centred-subject line only where the app also crops the cover to another shape.
      expect(node.textContent?.includes('Deixe o principal no centro')).toBe(size.alsoOtherShapes);
    },
  );

  it('never prints an em dash', () => {
    for (const kind of Object.keys(COVER_SIZES)) {
      expect(hint(kind as CoverKind).textContent).not.toContain('—');
      cleanup();
    }
  });
});

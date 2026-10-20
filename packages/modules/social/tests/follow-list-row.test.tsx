// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FollowListRow } from '../ui/FollowListRow';

/**
 * 09-10 (UI-D-502, UI-D-503, EP-44, E07): the split person row. A link slot (photo and the two
 * truncating lines) and a SIBLING action slot, so a tap on the name opens the profile and a tap on
 * the button follows, and neither contains the other. The DOM order is link then action, so keyboard
 * focus meets the person before the action. The geometry is `MemberRow`'s shipped one, so the loading
 * skeleton and the rows do not shift when the list resolves.
 */

afterEach(cleanup);

function renderRow(props: Partial<React.ComponentProps<typeof FollowListRow>> = {}) {
  return render(
    <FollowListRow
      href="/membros/abc"
      avatar={<span data-testid="avatar" />}
      name="Ana Souza"
      snippet="Trago o café."
      action={<button type="button">act</button>}
      {...props}
    />,
  );
}

describe('FollowListRow', () => {
  it('R1: the link slot comes before the action slot, as siblings', () => {
    const { container } = renderRow();
    const row = container.firstElementChild as HTMLElement;
    expect(row.children).toHaveLength(2);
    const [linkSlot, actionSlot] = Array.from(row.children) as HTMLElement[];
    expect(linkSlot?.tagName).toBe('A');
    expect(linkSlot?.getAttribute('href')).toBe('/membros/abc');
    expect(actionSlot?.querySelector('button')).not.toBeNull();
    expect(linkSlot?.contains(screen.getByRole('button'))).toBe(false);
  });

  it("R2: the row is MemberRow's geometry: min-h-14, gap-3, px-4 py-3", () => {
    const { container } = renderRow();
    const row = container.firstElementChild as HTMLElement;
    for (const token of ['flex', 'min-h-14', 'items-center', 'gap-3', 'px-4', 'py-3']) {
      expect(row.className).toContain(token);
    }
  });

  it('R3: photo and text live inside the link; name and snippet truncate', () => {
    renderRow();
    const link = screen.getByRole('link');
    expect(link.contains(screen.getByTestId('avatar'))).toBe(true);
    expect(link.className).toContain('min-w-0');
    expect(link.className).toContain('flex-1');
    const name = screen.getByText('Ana Souza');
    expect(name.className).toContain('truncate');
    expect(name.className).toContain('font-bold');
    const snippet = screen.getByText('Trago o café.');
    expect(snippet.className).toContain('truncate');
    expect(snippet.className).toContain('text-text-tertiary');
  });

  it('R4: a row with no snippet renders one line and keeps min-h-14', () => {
    const { container } = renderRow({ snippet: null });
    expect(screen.queryByText('Trago o café.')).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain('min-h-14');
  });

  it('R5: the action slot never shrinks', () => {
    const { container } = renderRow();
    const actionSlot = (container.firstElementChild as HTMLElement).children[1] as HTMLElement;
    expect(actionSlot.className).toContain('shrink-0');
  });
});

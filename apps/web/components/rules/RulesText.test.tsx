// @vitest-environment happy-dom
import { RULES_TEXT_MAX } from '@rede-social/contracts/rules';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RulesText } from './RulesText';

/**
 * 08-07 (UI-D-281, E14) — the one rules renderer behind `/cadastro`, `/aceitar-convite` and the
 * Regras preview. Claims: paragraphs split on a blank line; a single line break stays inside its
 * paragraph (and the paragraph keeps it visible through `whitespace-pre-line`); a 10,000-character
 * text renders every paragraph; a long URL sits in a paragraph that may wrap anywhere.
 */

afterEach(cleanup);

function paragraphs(container: HTMLElement): HTMLParagraphElement[] {
  return Array.from(container.querySelectorAll('p'));
}

describe('RulesText', () => {
  it('splits paragraphs on a blank line and drops empty blocks', () => {
    const { container } = render(
      <RulesText rulesText={'Primeiro parágrafo.\n\nSegundo parágrafo.\n\n\n\nTerceiro.\n\n'} />,
    );
    expect(paragraphs(container).map((p) => p.textContent)).toEqual([
      'Primeiro parágrafo.',
      'Segundo parágrafo.',
      'Terceiro.',
    ]);
  });

  it('keeps a single line break inside its paragraph, rendered with whitespace-pre-line', () => {
    const { container } = render(
      <RulesText rulesText={'Regras:\n1. Respeite.\n2. Sem spam.\n\nFim.'} />,
    );
    const [list, end] = paragraphs(container);
    expect(paragraphs(container)).toHaveLength(2);
    expect(list?.textContent).toBe('Regras:\n1. Respeite.\n2. Sem spam.');
    expect(list?.className).toContain('whitespace-pre-line');
    expect(end?.textContent).toBe('Fim.');
  });

  it('renders every paragraph of a 10,000-character text', () => {
    const block = 'x'.repeat(98);
    // 100 paragraphs of 98 characters joined by blank lines: 100 * 98 + 99 * 2 = 9,998.
    const text = Array.from({ length: 100 }, () => block).join('\n\n');
    const padded = `${text}yy`;
    expect(padded.length).toBe(RULES_TEXT_MAX);
    const { container } = render(<RulesText rulesText={padded} />);
    expect(paragraphs(container)).toHaveLength(100);
    // Identical paragraphs are legal: every one is rendered, none collapsed by a key clash.
    expect(paragraphs(container).filter((p) => p.textContent === block)).toHaveLength(99);
  });

  it('lets a long URL wrap anywhere inside its paragraph', () => {
    const url = `https://exemplo.com.br/${'caminho-muito-longo/'.repeat(20)}`;
    const { container } = render(<RulesText rulesText={`Leia também: ${url}`} />);
    const [p] = paragraphs(container);
    expect(p?.textContent).toContain(url);
    expect(p?.className).toContain('[overflow-wrap:anywhere]');
  });

  it('renders text, never markup', () => {
    const { container } = render(<RulesText rulesText={'<b>negrito</b> <script>x</script>'} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(paragraphs(container)[0]?.textContent).toBe('<b>negrito</b> <script>x</script>');
  });
});

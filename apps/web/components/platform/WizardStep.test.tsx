// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The wizard's step heading (`WizardStepIntro`) under a name with no spaces (2026-10-03). Dados takes
 * a display name of up to 60 characters with no format rule (a pasted domain, words run together),
 * and the line under each step's title names the tenant: `DraftStepIntro` on Personalização, Domínio
 * and Resumo, the invite page (a server component) with the first admin's e-mail too. One unbroken
 * word wider than the column made the whole step scroll sideways (805px of page in a 375px window);
 * the line now breaks such a word inside the column.
 *
 * The catalog is the REAL pt-BR one: the steps translate through next-intl's own translator (a
 * missing key throws), and the expected lines are the catalog's own strings with their placeholders
 * filled here (the AdminsCard.test.tsx pattern). The draft is a stand-in for `TenantDraftProvider`.
 * happy-dom has no layout engine, so the wrap is asserted on the class that produces it
 * (`break-words`, `overflow-wrap: break-word`; the ParticipantsList.test.tsx precedent); the widths
 * were measured in Chrome.
 *
 * Claims:
 *  1. Every step that names the tenant before it exists breaks a 60-letter name inside its line.
 *  2. The invite step's line breaks a long e-mail (and the name) the same way.
 *  3. The title keeps its own line, outside the one that breaks.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    // Vitest runs from `apps/web` (the `NotificationsSurface.test.tsx` precedent).
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    draft: { displayName: '' },
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace?: string) => {
      const key = namespace ?? '';
      let tr = byNamespace.get(key);
      if (!tr) {
        tr = actual.createTranslator({
          locale: 'pt-BR',
          messages: harness.messages,
          namespace,
          onError: (error) => {
            throw error;
          },
        });
        byNamespace.set(key, tr);
      }
      return tr;
    },
  };
});

vi.mock('./wizard/TenantDraftProvider', () => ({
  useTenantDraft: () => ({ draft: harness.draft }),
}));

const { WizardStepIntro } = await import('./WizardStep');
const { DraftStepIntro } = await import('./wizard/DraftStepIntro');

type StepCopy = { title: string; body: string };
const WIZARD = (
  harness.messages.platform as unknown as {
    wizard: Record<'brand' | 'domain' | 'summary' | 'invite', StepCopy>;
  }
).wizard;

/** A catalog line with its plain `{name}` placeholders filled, as the translator fills them. */
const fill = (copy: string, values: Record<string, string>) =>
  copy.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

/** The longest display name Dados accepts, with nowhere to break it. */
const NAME = 'W'.repeat(60);
const EMAIL = `${'primeiro.administrador'.repeat(2)}@${'clube'.repeat(8)}.com.br`;

/** The line right under a step's title. */
const lineUnder = (title: string) =>
  screen.getByRole('heading', { level: 2, name: title }).nextElementSibling as HTMLElement;
const classesOf = (el: Element) => el.className.split(' ');

afterEach(cleanup);

describe('the step heading under a name with no spaces', () => {
  it('breaks the tenant’s name inside the line on every step that names it', () => {
    harness.draft.displayName = NAME;
    for (const step of ['brand', 'domain', 'summary'] as const) {
      render(<DraftStepIntro step={step} />);
      const line = lineUnder(WIZARD[step].title);
      expect(line.textContent).toBe(fill(WIZARD[step].body, { tenant: NAME }));
      expect(line.textContent).toContain(NAME);
      expect(classesOf(line)).toContain('break-words');
      cleanup();
    }
  });

  it('breaks the invite step’s e-mail the same way, the title on its own line', () => {
    const { title } = WIZARD.invite;
    render(
      <WizardStepIntro
        title={title}
        body={fill(WIZARD.invite.body, { tenant: NAME, email: EMAIL })}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: title });
    const line = lineUnder(title);
    expect(line.tagName).toBe('P');
    expect(line.textContent).toContain(EMAIL);
    expect(line.textContent).toContain(NAME);
    expect(classesOf(line)).toContain('break-words');
    // The title is the catalog's own words, never the name: its own line, outside the one that breaks.
    expect(heading.textContent).toBe(title);
    expect(heading.contains(line)).toBe(false);
  });
});

// @vitest-environment happy-dom
import { deriveBrandColors, emptyBrandLook, NEUTRAL_BRAND } from '@rede-social/contracts/branding';
import { buttonInk, buttonRampEnd } from '@rede-social/core/ui';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookBodyOf } from '@/lib/bg-tone';
import type { TenantDraft } from './TenantDraftProvider';

/**
 * The summary (Resumo) and the confirmation list the look's colours the way they list the title
 * font: each ONLY when the tenant changed it. Since 2026-10-03 the creation saves them, so nothing
 * is marked "só na prévia" any more.
 *
 * The catalog is the REAL pt-BR one through next-intl's own translator (a missing key throws). The
 * server actions and the router are stubbed: nothing here writes. The kernel mini-shells are the
 * real `BrandPreview`, so what their frames carry is asserted too.
 *
 * Claims:
 *  1. A draft that kept the system's colours adds no row: no ground, no dark block, no inks, in the
 *     summary and in the confirmation alike, and the mini-shells carry no tone.
 *  2. A changed light ground shows its own swatch (the id on an element painted from the tone's
 *     token, no hex) and its name.
 *  3. The dark block lists only the dark colours that were changed, and its ground by name.
 *  4. The inks list only the values that were changed, per theme.
 *  5. The buttons' block lists only the colours set per mode (never what the dark mode inherits);
 *     a gradient leads with its style, names its first colour "Cor
 *     inicial" and lists its last colour, even with every colour automatic.
 *  6. The confirmation adds the same four rows, in short phrases, with no "só na prévia" mark.
 *  7. The mini-shells of both show what those rows list: the light frame on the chosen ground, the
 *     dark one on its tone with the dark primary (both of its primaries), each with its mode's
 *     buttons (the dark frame inheriting the light button, a gradient with its image, an automatic
 *     dark gradient starting on the dark mode's own primary), never the defaults.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return {
    messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')),
    draft: null as unknown,
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement('a', { href, ...rest }, children),
  };
});

vi.mock('@/app/(platform)/plataforma/novo/actions', () => ({
  createTenantFromDraftAction: vi.fn(),
  findCreatedTenantAction: vi.fn(),
}));
vi.mock('@/app/(platform)/plataforma/tenants/[id]/dominios/actions', () => ({
  attachDomainAction: vi.fn(),
}));
vi.mock('@/app/(platform)/plataforma/tenants/[id]/marca/actions', () => ({
  completeBrandingUploadAction: vi.fn(),
  startBrandingUploadAction: vi.fn(),
}));

vi.mock('./TenantDraftProvider', () => ({
  useTenantDraft: () => harness.draft,
}));

MotionGlobalConfig.skipAnimations = true;

const { WizardSummary } = await import('./WizardSummary');
const { CreateTenantDialog } = await import('./CreateTenantDialog');

type SummaryCopy = {
  buttonsTitle: string;
  fields: { buttonStyle: string };
};
const S = (harness.messages.platform as unknown as { wizard: { summary: SummaryCopy } }).wizard
  .summary;

type ButtonColors = TenantDraft['buttonColors'];

/** Button colours with only what is given set, solid unless said otherwise. */
const buttonSet = (
  fill: Partial<ButtonColors['fill']> = {},
  ink: Partial<ButtonColors['ink']> = {},
  fillEnd: Partial<ButtonColors['fillEnd']> = {},
  style: ButtonColors['style'] = 'solid',
): ButtonColors => ({
  style,
  fill: { light: null, dark: null, ...fill },
  fillEnd: { light: null, dark: null, ...fillEnd },
  ink: { light: null, dark: null, ...ink },
});

const BASE: TenantDraft = {
  displayName: 'Clube Aurora',
  slug: 'clube-aurora',
  slugTouched: false,
  primary: NEUTRAL_BRAND.primary,
  secondary: NEUTRAL_BRAND.secondary,
  modules: {},
  adminEmail: 'admin@clube.test',
  contrastConfirmed: false,
  titleFont: null,
  lightTone: null,
  darkColors: { primary: null, secondary: null, tone: null },
  fontColors: { title: { light: null, dark: null }, appName: { light: null, dark: null } },
  buttonColors: buttonSet(),
  host: '',
  hostReady: true,
  dataReady: true,
  fieldErrors: {},
  pendingSlug: null,
  createdId: null,
};

const CHANGED: Partial<TenantDraft> = {
  lightTone: 'amarelado',
  darkColors: { primary: '#ffb4a8', secondary: null, tone: 'cafe' },
  fontColors: {
    title: { light: '#7c2d12', dark: null },
    appName: { light: null, dark: '#a7f3d0' },
  },
  // The reference: a gold button with chocolate text in the light mode, which the dark inherits.
  buttonColors: buttonSet({ light: '#e3af3f' }, { light: '#382317' }),
};

function stageDraft(initial?: Partial<TenantDraft>) {
  const draft = { ...BASE, ...initial };
  harness.draft = {
    draft,
    colors: { primary: draft.primary, secondary: draft.secondary },
    enabledModules: [],
    logo: null,
    icon: null,
    update: vi.fn(),
    setConfirming: vi.fn(),
  };
}

const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;

/** The light and the dark mini-shell under `root`, and how many brand scopes there are. */
function frames(root: ParentNode = document) {
  const all = Array.from(root.querySelectorAll<HTMLElement>('[data-brand-scope]'));
  return {
    count: all.length,
    light: all.find((frame) => frame.getAttribute('data-theme') === 'light'),
    dark: all.find((frame) => frame.getAttribute('data-theme') === 'dark'),
  };
}

/** `--name: value` in an inline style, whatever spacing the serialisation keeps. */
const styleHas = (frame: HTMLElement | undefined, name: string, value: string) =>
  new RegExp(`${name}:\\s*${value}(;|$)`, 'i').test(frame?.getAttribute('style') ?? '');

/** The value of `--name` in an inline style (a gradient holds parentheses no regex should see). */
const declared = (frame: HTMLElement | undefined, name: string) => {
  for (const part of (frame?.getAttribute('style') ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
};

/** The reference's gold to a pale gold, chocolate text, set in the light mode only. */
const GRADIENT = buttonSet(
  { light: '#e3af3f' },
  { light: '#382317' },
  { light: '#ffd27a' },
  'gradient',
);

/**
 * A dark primary of its own, which only a gradient's automatic dark colours read: a summary that
 * forgot to hand the dark colours over would start that gradient on the derived accent instead.
 */
const OWN_DARK = '#ffb4a8';
const DARK_PRIMARY: TenantDraft['darkColors'] = { primary: OWN_DARK, secondary: null, tone: null };
/** That primary to its ramp (`buttonRampEnd`, away from the text that reads on it). */
const OWN_DARK_END = buttonRampEnd(OWN_DARK, buttonInk(OWN_DARK));
const OWN_DARK_GRADIENT = `linear-gradient(135deg, ${OWN_DARK}, ${OWN_DARK_END})`;

afterEach(cleanup);

describe('the summary', () => {
  it('adds nothing for a draft that kept the system colours', () => {
    stageDraft();
    render(<WizardSummary />);
    expect(document.querySelector('[data-summary-background]')).toBeNull();
    expect(document.querySelector('[data-summary-dark]')).toBeNull();
    expect(document.querySelector('[data-summary-font-colors]')).toBeNull();
    expect(document.querySelector('[data-summary-buttons]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/prévia/);
  });

  it('keeps the mini-shells on the system look for such a draft', () => {
    stageDraft({
      lightTone: 'cinza',
      darkColors: { primary: null, secondary: null, tone: 'grafite' },
    });
    render(<WizardSummary />);
    const { count, light, dark } = frames();
    expect(count).toBe(2);
    expect(light?.hasAttribute('data-bg-tone')).toBe(false);
    expect(dark?.hasAttribute('data-dark-tone')).toBe(false);
    expect(light?.getAttribute('style')).not.toContain('--button-');
    expect(dark?.getAttribute('style')).not.toContain('--button-');
  });

  it('a default tone set explicitly still adds nothing', () => {
    stageDraft({
      lightTone: 'cinza',
      darkColors: { primary: null, secondary: null, tone: 'grafite' },
    });
    render(<WizardSummary />);
    expect(document.querySelector('[data-summary-background]')).toBeNull();
    expect(document.querySelector('[data-summary-dark]')).toBeNull();
  });

  it('lists what changed, with no preview-only mark (saved since 2026-10-03)', () => {
    stageDraft(CHANGED);
    render(<WizardSummary />);

    const ground = document.querySelector('[data-summary-background]') as HTMLElement;
    expect(ground.textContent).toContain('Amarelado');
    expect(ground.textContent).not.toMatch(/prévia/);
    const swatch = ground.querySelector('[data-bg-tone]');
    expect(swatch?.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(swatch?.className).toContain('bg-[var(--tone-ground)]');

    const dark = document.querySelector('[data-summary-dark]') as HTMLElement;
    expect(dark.textContent).toContain('#ffb4a8');
    expect(dark.textContent).toContain('Café');
    expect(dark.textContent).not.toMatch(/prévia/);
    // Only the changed dark colours: the secondary kept its automatic value.
    expect(dark.textContent).not.toContain('Cor secundária');
    expect(dark.querySelector('[data-dark-tone]')?.getAttribute('data-dark-tone')).toBe('cafe');

    const inks = document.querySelector('[data-summary-font-colors]') as HTMLElement;
    expect(inks.textContent).toContain('Cor dos títulos (claro)');
    expect(inks.textContent).toContain('#7c2d12');
    expect(inks.textContent).toContain('Cor do nome no topo (escuro)');
    expect(inks.textContent).toContain('#a7f3d0');
    expect(inks.textContent).not.toContain('Cor dos títulos (escuro)');
    expect(inks.textContent).not.toMatch(/prévia/);

    const buttons = document.querySelector('[data-summary-buttons]') as HTMLElement;
    expect(buttons.textContent).toContain(S.buttonsTitle);
    expect(buttons.textContent).toContain('Cor do botão (claro)');
    expect(buttons.textContent).toContain('#e3af3f');
    expect(buttons.textContent).toContain('Cor do texto do botão (claro)');
    expect(buttons.textContent).toContain('#382317');
    expect(buttons.textContent).not.toMatch(/prévia/);
    // Only what was set: the dark mode inherits the light button, and that is not its own.
    expect(buttons.textContent).not.toContain('(escuro)');
  });

  it('lists a dark button alone when only the dark mode has one', () => {
    stageDraft({
      buttonColors: buttonSet({ dark: '#ffd27a' }),
    });
    render(<WizardSummary />);
    const buttons = document.querySelector('[data-summary-buttons]') as HTMLElement;
    expect(buttons.textContent).toContain('Cor do botão (escuro)');
    expect(buttons.textContent).toContain('#ffd27a');
    expect(buttons.textContent).not.toContain('(claro)');
    expect(buttons.textContent).not.toContain('Cor do texto do botão');
  });

  it('lists a light text alone, its frame carrying the text and no fill', () => {
    stageDraft({
      buttonColors: buttonSet({}, { light: '#382317' }),
    });
    render(<WizardSummary />);
    const buttons = document.querySelector('[data-summary-buttons]') as HTMLElement;
    expect(buttons.textContent).toContain('Cor do texto do botão (claro)');
    expect(buttons.textContent).toContain('#382317');
    expect(buttons.textContent).not.toMatch(/prévia/);
    expect(buttons.textContent).not.toContain('Cor do botão (');
    const { light, dark } = frames();
    expect(styleHas(light, '--button-ink-light', '#382317')).toBe(true);
    expect(light?.getAttribute('style')).not.toContain('--button-fill-');
    expect(dark?.getAttribute('style')).not.toContain('--button-');
    cleanup();

    stageDraft({
      buttonColors: buttonSet({}, { light: '#382317' }),
    });
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(text('[data-confirm-buttons]')).toBe(`texto #382317 no claro`);
  });

  it('shows the same look in its mini-shells', () => {
    stageDraft(CHANGED);
    render(<WizardSummary />);
    const { count, light, dark } = frames();
    expect(count).toBe(2);
    expect(light?.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(light?.hasAttribute('data-dark-tone')).toBe(false);
    expect(dark?.getAttribute('data-dark-tone')).toBe('cafe');
    expect(styleHas(dark, '--brand-primary-dark', '#ffb4a8')).toBe(true);
    expect(styleHas(dark, '--brand-primary', '#ffb4a8')).toBe(true);
    // The light frame keeps the light pair.
    expect(styleHas(light, '--brand-primary', NEUTRAL_BRAND.primary)).toBe(true);
    // Each frame its mode's buttons; the dark one inherits the light button, text included.
    expect(styleHas(light, '--button-fill-light', '#e3af3f')).toBe(true);
    expect(styleHas(light, '--button-ink-light', '#382317')).toBe(true);
    expect(styleHas(dark, '--button-fill-dark', '#e3af3f')).toBe(true);
    expect(styleHas(dark, '--button-ink-dark', '#382317')).toBe(true);
    expect(light?.getAttribute('style')).not.toMatch(/--button-[a-z]+-dark/);
    cleanup();

    // A dark button of its own, unlike the light one: each frame gets its own mode's, never swapped.
    stageDraft({
      buttonColors: buttonSet({ light: '#e3af3f', dark: '#1a237e' }),
    });
    render(<WizardSummary />);
    const own = frames();
    expect(styleHas(own.light, '--button-fill-light', '#e3af3f')).toBe(true);
    expect(styleHas(own.dark, '--button-fill-dark', '#1a237e')).toBe(true);
    expect(own.light?.getAttribute('style')).not.toMatch(/--button-[a-z]+-dark/);
    expect(own.dark?.getAttribute('style')).not.toMatch(/--button-[a-z]+-light/);
  });
});

describe('the summary, a gradient button', () => {
  it('leads with the style, then names the first colour "Cor inicial" and lists the last', () => {
    stageDraft({ buttonColors: GRADIENT });
    render(<WizardSummary />);
    const block = document.querySelector('[data-summary-buttons]') as HTMLElement;
    const style = block.querySelector('[data-summary-button-style]') as HTMLElement;
    expect(style.textContent).toBe(`${S.fields.buttonStyle}Degradê`);
    expect(block.firstElementChild?.nextElementSibling).toBe(style);
    expect(block.textContent).toContain('Cor inicial do botão (claro)');
    expect(block.textContent).toContain('#e3af3f');
    expect(block.textContent).toContain('Cor final do botão (claro)');
    expect(block.textContent).toContain('#ffd27a');
    expect(block.textContent).toContain('Cor do texto do botão (claro)');
    expect(block.textContent).not.toContain('Cor do botão (');
    expect(block.textContent).not.toContain('(escuro)');
    expect(block.textContent).not.toMatch(/prévia/);
  });

  it('lists an automatic gradient by its style alone', () => {
    stageDraft({ buttonColors: buttonSet({}, {}, {}, 'gradient') });
    render(<WizardSummary />);
    const block = document.querySelector('[data-summary-buttons]') as HTMLElement;
    expect(block.querySelector('[data-summary-button-style]')).not.toBeNull();
    expect(block.textContent).not.toContain('#');
    expect(block.textContent).not.toMatch(/prévia/);
  });

  it('leaves out a solid button’s stored last colour, and the style', () => {
    stageDraft({ buttonColors: buttonSet({ light: '#e3af3f' }, {}, { light: '#ffd27a' }) });
    render(<WizardSummary />);
    const block = document.querySelector('[data-summary-buttons]') as HTMLElement;
    expect(block.querySelector('[data-summary-button-style]')).toBeNull();
    expect(block.textContent).toContain('Cor do botão (claro)');
    expect(block.textContent).not.toContain('#ffd27a');
    expect(declared(frames().light, '--button-image-light')).toBeNull();
  });

  it('shows each mode’s gradient in its mini-shell, the automatic one included', () => {
    stageDraft({ buttonColors: GRADIENT });
    render(<WizardSummary />);
    const set = frames();
    expect(set.count).toBe(2);
    expect(declared(set.light, '--button-image-light')).toBe(
      'linear-gradient(135deg, #e3af3f, #ffd27a)',
    );
    // The dark mode takes both light colours, and the text with them.
    expect(declared(set.dark, '--button-image-dark')).toBe(
      'linear-gradient(135deg, #e3af3f, #ffd27a)',
    );
    expect(declared(set.dark, '--button-ink-dark')).toBe('#382317');
    expect(set.light?.getAttribute('style')).not.toMatch(/--button-[a-z-]+-dark/);
    cleanup();

    stageDraft({ buttonColors: buttonSet({}, {}, {}, 'gradient') });
    render(<WizardSummary />);
    const auto = frames();
    const pair = deriveBrandColors(NEUTRAL_BRAND);
    // The automatic one: each mode's accent to its ramp, away from the text that reads on it.
    const ramp = (fill: string) => buttonRampEnd(fill, buttonInk(fill));
    expect(declared(auto.light, '--button-image-light')).toBe(
      `linear-gradient(135deg, ${pair.primary}, ${ramp(pair.primary)})`,
    );
    expect(declared(auto.dark, '--button-image-dark')).toBe(
      `linear-gradient(135deg, ${pair.primaryDark}, ${ramp(pair.primaryDark)})`,
    );
  });

  it('starts the dark mini-shell’s automatic gradient on the dark mode’s own primary', () => {
    stageDraft({ darkColors: DARK_PRIMARY, buttonColors: buttonSet({}, {}, {}, 'gradient') });
    render(<WizardSummary />);
    const { light, dark } = frames();
    // That primary to its ramp, the gradient the card and the phone show, on the frame that
    // declares that very primary: never the derived accent's gradient beside it.
    expect(styleHas(dark, '--brand-primary-dark', OWN_DARK)).toBe(true);
    expect(declared(dark, '--button-fill-dark')).toBe(OWN_DARK);
    expect(declared(dark, '--button-image-dark')).toBe(OWN_DARK_GRADIENT);
    // The light frame keeps the light accent's gradient.
    const { primary } = deriveBrandColors(NEUTRAL_BRAND);
    const lightEnd = buttonRampEnd(primary, buttonInk(primary));
    expect(declared(light, '--button-image-light')).toBe(
      `linear-gradient(135deg, ${primary}, ${lightEnd})`,
    );
  });
});

describe('the confirmation', () => {
  it('adds no row for a draft that kept the system colours', () => {
    stageDraft();
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(document.querySelector('[data-confirm-font]')).not.toBeNull();
    expect(document.querySelector('[data-confirm-background]')).toBeNull();
    expect(document.querySelector('[data-confirm-dark]')).toBeNull();
    expect(document.querySelector('[data-confirm-font-colors]')).toBeNull();
    expect(document.querySelector('[data-confirm-buttons]')).toBeNull();
  });

  it('lists the changed colours in short phrases, with no preview-only mark', () => {
    stageDraft(CHANGED);
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(text('[data-confirm-background]')).toBe(`Amarelado`);
    expect(text('[data-confirm-dark]')).toBe(`primária #FFB4A8 e fundo Café`);
    expect(text('[data-confirm-font-colors]')).toBe(
      `títulos #7C2D12 no claro e nome no topo #A7F3D0 no escuro`,
    );
    expect(text('[data-confirm-buttons]')).toBe(`botão #E3AF3F no claro e texto #382317 no claro`);
    cleanup();

    stageDraft({
      buttonColors: buttonSet({ dark: '#ffd27a' }),
    });
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(text('[data-confirm-buttons]')).toBe(`botão #FFD27A no escuro`);
  });

  it('shows in its mini-shells exactly what its rows list', () => {
    stageDraft(CHANGED);
    render(<CreateTenantDialog open onClose={() => {}} />);
    const review = document.querySelector('[data-create-dialog="review"]') as HTMLElement;
    const { count, light, dark } = frames(review);
    expect(count).toBe(2);
    expect(light?.getAttribute('data-bg-tone')).toBe('amarelado');
    expect(dark?.getAttribute('data-dark-tone')).toBe('cafe');
    expect(styleHas(dark, '--brand-primary-dark', '#ffb4a8')).toBe(true);
    expect(styleHas(light, '--button-fill-light', '#e3af3f')).toBe(true);
    expect(styleHas(dark, '--button-fill-dark', '#e3af3f')).toBe(true);
    expect(styleHas(dark, '--button-ink-dark', '#382317')).toBe(true);
    cleanup();

    stageDraft({
      buttonColors: buttonSet({ light: '#e3af3f', dark: '#1a237e' }),
    });
    render(<CreateTenantDialog open onClose={() => {}} />);
    const own = frames(document.querySelector('[data-create-dialog="review"]') as HTMLElement);
    expect(styleHas(own.light, '--button-fill-light', '#e3af3f')).toBe(true);
    expect(styleHas(own.dark, '--button-fill-dark', '#1a237e')).toBe(true);
    expect(own.light?.getAttribute('style')).not.toMatch(/--button-[a-z]+-dark/);
    expect(own.dark?.getAttribute('style')).not.toMatch(/--button-[a-z]+-light/);
    cleanup();

    stageDraft();
    render(<CreateTenantDialog open onClose={() => {}} />);
    const plain = frames(document.querySelector('[data-create-dialog="review"]') as HTMLElement);
    expect(plain.count).toBe(2);
    expect(plain.light?.hasAttribute('data-bg-tone')).toBe(false);
    expect(plain.dark?.hasAttribute('data-dark-tone')).toBe(false);
    expect(styleHas(plain.dark, '--brand-primary-dark', '#ffb4a8')).toBe(false);
    expect(plain.light?.getAttribute('style')).not.toContain('--button-');
    expect(plain.dark?.getAttribute('style')).not.toContain('--button-');
  });

  it('says the gradient first, then its colours, each in its own words', () => {
    stageDraft({ buttonColors: GRADIENT });
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(text('[data-confirm-buttons]')).toBe(
      `degradê, cor inicial #E3AF3F no claro, cor final #FFD27A no claro e texto #382317 no claro`,
    );
    // Its mini-shells paint that gradient, the dark one taking both light colours.
    const review = document.querySelector('[data-create-dialog="review"]') as HTMLElement;
    const { light, dark } = frames(review);
    expect(declared(light, '--button-image-light')).toBe(
      'linear-gradient(135deg, #e3af3f, #ffd27a)',
    );
    expect(declared(dark, '--button-image-dark')).toBe('linear-gradient(135deg, #e3af3f, #ffd27a)');
    expect(declared(dark, '--button-ink-dark')).toBe('#382317');
    cleanup();

    // Every colour automatic: the style alone is the change.
    stageDraft({ buttonColors: buttonSet({}, {}, {}, 'gradient') });
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(text('[data-confirm-buttons]')).toBe(`degradê`);
    cleanup();

    // A dark colour of its own reads as such.
    stageDraft({
      buttonColors: buttonSet({ dark: '#1a237e' }, {}, { dark: '#e3af3f' }, 'gradient'),
    });
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(text('[data-confirm-buttons]')).toBe(
      `degradê, cor inicial #1A237E no escuro e cor final #E3AF3F no escuro`,
    );
  });

  it('never says a solid button’s stored last colour', () => {
    stageDraft({ buttonColors: buttonSet({ light: '#e3af3f' }, {}, { light: '#ffd27a' }) });
    render(<CreateTenantDialog open onClose={() => {}} />);
    expect(text('[data-confirm-buttons]')).toBe(`botão #E3AF3F no claro`);
  });

  it('starts the dark mini-shell’s automatic gradient on the dark mode’s own primary', () => {
    stageDraft({ darkColors: DARK_PRIMARY, buttonColors: buttonSet({}, {}, {}, 'gradient') });
    render(<CreateTenantDialog open onClose={() => {}} />);
    const review = document.querySelector('[data-create-dialog="review"]') as HTMLElement;
    const { dark } = frames(review);
    expect(styleHas(dark, '--brand-primary-dark', OWN_DARK)).toBe(true);
    expect(declared(dark, '--button-fill-dark')).toBe(OWN_DARK);
    expect(declared(dark, '--button-image-dark')).toBe(OWN_DARK_GRADIENT);
  });
});

/**
 * 2026-10-03: "Criar tenant" SAVES the look. The confirmation sends it with the pair and the
 * modules, checked by `lookBodyOf` (the very values the rows list, in the contract's shape: the dark
 * ground apart, a solid button's last colours kept aside, a malformed value as `null`).
 */
describe('the confirmation sends the look', () => {
  it('hands the action the whole look with the pair, the modules and the first admin', async () => {
    const actions = await import('@/app/(platform)/plataforma/novo/actions');
    const create = vi.mocked(actions.createTenantFromDraftAction);
    create.mockReset();
    create.mockResolvedValue({ ok: false, error: 'generic' });
    stageDraft({
      ...CHANGED,
      titleFont: 'Poppins',
      buttonColors: buttonSet({ light: '#e3af3f' }, { light: '#382317' }, { light: '#ffd27a' }),
    });
    render(<CreateTenantDialog open onClose={() => {}} />);
    fireEvent.click(document.querySelector('[data-create-confirm]') as HTMLElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    const sent = create.mock.calls[0]?.[0];
    expect(sent?.primary).toBe(BASE.primary);
    expect(sent?.look).toEqual({
      lightTone: 'amarelado',
      darkTone: 'cafe',
      darkColors: { primary: '#ffb4a8', secondary: null },
      titleFont: 'Poppins',
      fontColors: {
        title: { light: '#7c2d12', dark: null },
        appName: { light: null, dark: '#a7f3d0' },
      },
      buttonColors: {
        style: 'solid',
        fill: { light: '#e3af3f', dark: null },
        fillEnd: { light: '#ffd27a', dark: null },
        ink: { light: '#382317', dark: null },
      },
    });
    expect(sent?.look).toEqual(lookBodyOf((harness.draft as { draft: TenantDraft }).draft));
  });

  it('sends the system look for a draft that kept it', async () => {
    const actions = await import('@/app/(platform)/plataforma/novo/actions');
    const create = vi.mocked(actions.createTenantFromDraftAction);
    create.mockReset();
    create.mockResolvedValue({ ok: false, error: 'generic' });
    stageDraft({ lightTone: 'cinza', titleFont: 'Manrope' });
    render(<CreateTenantDialog open onClose={() => {}} />);
    fireEvent.click(document.querySelector('[data-create-confirm]') as HTMLElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0].look).toEqual(emptyBrandLook());
  });
});

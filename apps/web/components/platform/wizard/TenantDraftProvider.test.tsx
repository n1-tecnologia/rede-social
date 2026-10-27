// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_ICON_SETTINGS } from '@/lib/app-icon';
import { emptyButtonColors, emptyDarkColors, emptyFontColors } from '@/lib/bg-tone';
import { TenantPreviewProvider, useTenantPreview } from '../preview/TenantPreviewProvider';
import { useBrandLook } from './brand-look-context';
import { TenantDraftProvider, useTenantDraft } from './TenantDraftProvider';

/**
 * The wizard draft's look (2026-10-02; saved with the tenant since 2026-10-03): the light ground
 * tone, the dark mode's colours, the font colours and (2026-10-03) the button colours, which the
 * look's cards reach through the look context (5). Real: both providers and React;
 * stubbed: the route params (a step before creation has no id) and next-intl (nothing here
 * translates, an import pulls it in). The claims a later edit could quietly break:
 *
 *  1. A new draft holds the system's values (`null` everywhere) and publishes them as such.
 *  2. A stored draft reads back only known ids and valid hexes; anything else, a default id
 *     included, is `null` (a field left out of `restoredDraft` is lost on reload). The buttons'
 *     style and a gradient's last colours come back too, and a draft stored before them (round 1:
 *     no style, no last colour) comes back as the solid button it was.
 *  3. `update` stores what is typed (the fields keep a half-typed hex), while the preview gets only
 *     the last valid colour; a reset to `null` clears it; the whole look reaches the device, the
 *     buttons' style included.
 *  4. None of it gates a step (`brandReady`), the tab's storage mirrors it, `reset` clears it, and
 *     a step that carries the created tenant's id publishes nothing (`PreviewSeed` owns the device).
 *  6. The app icon's choices (2026-10-09) live in memory only, like the files, and `reset` clears
 *     them.
 */

const route = vi.hoisted(() => ({ params: {} as { id?: string } }));
vi.mock('next/navigation', () => ({ useParams: () => route.params }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const STORAGE_KEY = 'rede-social:novo-tenant';

let draft: ReturnType<typeof useTenantDraft>;
let preview: ReturnType<typeof useTenantPreview>;
function Probe() {
  draft = useTenantDraft();
  preview = useTenantPreview();
  return null;
}

function mount() {
  return render(
    <TenantPreviewProvider initialTheme="light">
      <TenantDraftProvider moduleKeys={['feed', 'events']}>
        <Probe />
      </TenantDraftProvider>
    </TenantPreviewProvider>,
  );
}

const stored = () => JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');

beforeEach(() => {
  route.params = {};
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('TenantDraftProvider — the look', () => {
  it('1. starts from the system values and publishes them as such', () => {
    mount();
    expect(draft.restored).toBe(true);
    expect(draft.draft.lightTone).toBeNull();
    expect(draft.draft.darkColors).toEqual(emptyDarkColors());
    expect(draft.draft.fontColors).toEqual(emptyFontColors());
    expect(draft.draft.buttonColors).toEqual(emptyButtonColors());
    expect(preview.source).toBe('draft');
    expect(preview.tenant).toMatchObject({
      lightTone: null,
      darkColors: emptyDarkColors(),
      fontColors: emptyFontColors(),
      buttonColors: emptyButtonColors(),
    });
  });

  it('2. reads a stored draft back keeping only known ids and valid hexes', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        displayName: 'Associação',
        lightTone: 'amarelado',
        darkColors: { primary: '#AABBCC', secondary: '#12', tone: 'musgo', extra: 1 },
        fontColors: {
          title: { light: '#101010', dark: 'red' },
          appName: { light: null, dark: '#FAFAFA' },
        },
        buttonColors: {
          fill: { light: '#E3AF3F', dark: '#e3a' },
          ink: { light: '#382317', dark: 'chocolate' },
          hover: { light: '#000000' },
        },
      }),
    );
    mount();
    expect(draft.draft.displayName).toBe('Associação');
    expect(draft.draft.lightTone).toBe('amarelado');
    expect(draft.draft.darkColors).toEqual({ primary: '#aabbcc', secondary: null, tone: 'musgo' });
    expect(draft.draft.fontColors).toEqual({
      title: { light: '#101010', dark: null },
      appName: { light: null, dark: '#fafafa' },
    });
    // Stored before the gradient (no style, no last colour): the solid button it was.
    expect(draft.draft.buttonColors).toEqual({
      style: 'solid',
      fill: { light: '#e3af3f', dark: null },
      fillEnd: { light: null, dark: null },
      ink: { light: '#382317', dark: null },
    });
    expect(preview.tenant).toMatchObject({
      lightTone: 'amarelado',
      darkColors: { primary: '#aabbcc', secondary: null, tone: 'musgo' },
      fontColors: draft.draft.fontColors,
      buttonColors: draft.draft.buttonColors,
    });
  });

  it('2. reads a stored gradient back, its style and last colours, and publishes them', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buttonColors: {
          style: 'gradient',
          fill: { light: '#E3AF3F', dark: null },
          fillEnd: { light: '#FFD27A', dark: '#ffd' },
          ink: { light: null, dark: null },
        },
      }),
    );
    mount();
    expect(draft.draft.buttonColors).toEqual({
      style: 'gradient',
      fill: { light: '#e3af3f', dark: null },
      fillEnd: { light: '#ffd27a', dark: null },
      ink: { light: null, dark: null },
    });
    expect(preview.tenant.buttonColors).toEqual(draft.draft.buttonColors);
    cleanup();

    // A style this version does not know is the solid one.
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ buttonColors: { style: 'radial', fill: { light: '#e3af3f' } } }),
    );
    mount();
    expect(draft.draft.buttonColors.style).toBe('solid');
    expect(draft.draft.buttonColors.fill.light).toBe('#e3af3f');
  });

  it('2. reads a default id, an unknown one or a foreign shape as the system value', () => {
    for (const [lightTone, darkColors, fontColors, buttonColors] of [
      ['cinza', { tone: 'grafite' }, null, null],
      ['constructor', 'x', { title: 'x', appName: [1] }, 'gold'],
      [
        42,
        { primary: 'var(--x)', tone: '__proto__' },
        { title: { light: '#1234' } },
        { fill: ['#e3af3f'], ink: { light: '#38', dark: 42 } },
      ],
    ] as const) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ lightTone, darkColors, fontColors, buttonColors }),
      );
      mount();
      expect(draft.draft.lightTone).toBeNull();
      expect(draft.draft.darkColors).toEqual(emptyDarkColors());
      expect(draft.draft.fontColors).toEqual(emptyFontColors());
      expect(draft.draft.buttonColors).toEqual(emptyButtonColors());
      cleanup();
    }
  });

  it('3. stores what is typed, publishes only the last valid colour, clears on null', () => {
    mount();
    act(() => draft.update({ lightTone: 'azulado' }));
    act(() => draft.update({ darkColors: { ...draft.draft.darkColors, primary: '#123456' } }));
    expect(preview.tenant.lightTone).toBe('azulado');
    expect(preview.tenant.darkColors?.primary).toBe('#123456');

    // Half typed: the field keeps the text, the device keeps the last valid colour, even when
    // another edit publishes the draft again meanwhile.
    act(() => draft.update({ darkColors: { ...draft.draft.darkColors, primary: '#65' } }));
    expect(draft.draft.darkColors.primary).toBe('#65');
    expect(preview.tenant.darkColors?.primary).toBe('#123456');
    // The same last valid colours, for another preview (the BrandPreview mini-frames).
    expect(draft.previewColors.darkColors).toBe(preview.tenant.darkColors);
    act(() => draft.update({ lightTone: 'agua', displayName: 'Outra' }));
    expect(preview.tenant).toMatchObject({ displayName: 'Outra', lightTone: 'agua' });
    expect(preview.tenant.darkColors?.primary).toBe('#123456');

    act(() =>
      draft.update({
        darkColors: { ...draft.draft.darkColors, primary: '#654321', tone: 'vinho' },
        fontColors: {
          ...draft.draft.fontColors,
          title: { light: '#AA0000', dark: null },
        },
      }),
    );
    expect(preview.tenant.darkColors).toEqual({
      primary: '#654321',
      secondary: null,
      tone: 'vinho',
    });
    expect(preview.tenant.fontColors?.title).toEqual({ light: '#aa0000', dark: null });

    // "Usar a cor automática": back to the system's colour, in the draft and on the device.
    act(() => draft.update({ darkColors: { ...draft.draft.darkColors, primary: null } }));
    expect(draft.draft.darkColors.primary).toBeNull();
    expect(preview.tenant.darkColors?.primary).toBeNull();
  });

  it('3. the button colours: typed in the draft, the last valid ones on the device', () => {
    mount();
    const buttons = (fill: string | null, ink: string | null = null) => ({
      style: 'solid' as const,
      fill: { light: fill, dark: null },
      fillEnd: { light: null, dark: null },
      ink: { light: ink, dark: null },
    });
    act(() => draft.update({ buttonColors: buttons('#E3AF3F', '#382317') }));
    expect(preview.tenant.buttonColors).toEqual(buttons('#e3af3f', '#382317'));
    const settled = preview.tenant.buttonColors;

    // Half typed: the draft keeps the text, the device and the mini-frames the last valid colour.
    act(() => draft.update({ buttonColors: buttons('#e3', '#382317') }));
    expect(draft.draft.buttonColors.fill.light).toBe('#e3');
    expect(preview.tenant.buttonColors).toBe(settled);
    expect(draft.previewColors.buttonColors).toBe(preview.tenant.buttonColors);

    // Another edit publishes the draft again: the same button colours, by reference.
    const before = draft.previewColors;
    act(() => draft.update({ lightTone: 'agua' }));
    expect(draft.previewColors).toBe(before);
    expect(preview.tenant.buttonColors).toBe(settled);
    // The same values typed again: nothing new for the device.
    act(() => draft.update({ buttonColors: buttons('#e3af3f', '#382317') }));
    expect(draft.previewColors).toBe(before);

    // A dark button of its own, and the light text back to automatic ("Usar a cor automática").
    act(() =>
      draft.update({
        buttonColors: {
          style: 'solid',
          fill: { light: '#e3af3f', dark: '#1A237E' },
          fillEnd: { light: null, dark: null },
          ink: { light: null, dark: null },
        },
      }),
    );
    expect(draft.draft.buttonColors.ink.light).toBeNull();
    expect(preview.tenant.buttonColors).toEqual({
      style: 'solid',
      fill: { light: '#e3af3f', dark: '#1a237e' },
      fillEnd: { light: null, dark: null },
      ink: { light: null, dark: null },
    });
  });

  it('3. the buttons’ style and a gradient’s last colour reach the device like the rest', () => {
    mount();
    act(() =>
      draft.update({
        buttonColors: { ...draft.draft.buttonColors, fill: { light: '#e3af3f', dark: null } },
      }),
    );
    const solid = preview.tenant.buttonColors;
    // The style alone: a new object for the device, the colours kept by reference.
    act(() => draft.update({ buttonColors: { ...draft.draft.buttonColors, style: 'gradient' } }));
    expect(preview.tenant.buttonColors?.style).toBe('gradient');
    expect(preview.tenant.buttonColors?.fill).toBe(solid?.fill);
    expect(draft.previewColors.buttonColors).toBe(preview.tenant.buttonColors);

    // A last colour half typed stays in the draft; the device keeps the last valid one.
    act(() =>
      draft.update({
        buttonColors: { ...draft.draft.buttonColors, fillEnd: { light: '#FFD27A', dark: null } },
      }),
    );
    expect(preview.tenant.buttonColors?.fillEnd).toEqual({ light: '#ffd27a', dark: null });
    const settled = preview.tenant.buttonColors;
    act(() =>
      draft.update({
        buttonColors: { ...draft.draft.buttonColors, fillEnd: { light: '#ffd2', dark: null } },
      }),
    );
    expect(draft.draft.buttonColors.fillEnd.light).toBe('#ffd2');
    expect(preview.tenant.buttonColors).toBe(settled);

    // Back to solid: the last colour stays aside, in the draft and on the device.
    act(() => draft.update({ buttonColors: { ...draft.draft.buttonColors, style: 'solid' } }));
    expect(preview.tenant.buttonColors?.style).toBe('solid');
    expect(preview.tenant.buttonColors?.fillEnd).toEqual({ light: '#ffd27a', dark: null });
    expect(stored()).toMatchObject({ buttonColors: { style: 'solid' } });
  });

  it('4. gates nothing, is mirrored to the tab, and reset clears it', () => {
    mount();
    const ready = draft.brandReady;
    act(() =>
      draft.update({
        lightTone: 'lilas',
        darkColors: { primary: '#0a0a0a', secondary: '#fafafa', tone: 'berinjela' },
        fontColors: {
          title: { light: '#0a0a0a', dark: '#fafafa' },
          appName: { light: '#0a0a0a', dark: '#fafafa' },
        },
        buttonColors: {
          style: 'gradient',
          fill: { light: '#fafafa', dark: '#0a0a0a' },
          fillEnd: { light: '#0a0a0a', dark: '#fafafa' },
          ink: { light: '#0a0a0a', dark: '#fafafa' },
        },
      }),
    );
    expect(draft.brandReady).toBe(ready);
    expect(stored()).toMatchObject({
      lightTone: 'lilas',
      darkColors: { primary: '#0a0a0a', secondary: '#fafafa', tone: 'berinjela' },
      fontColors: { appName: { light: '#0a0a0a', dark: '#fafafa' } },
      buttonColors: {
        style: 'gradient',
        fill: { light: '#fafafa', dark: '#0a0a0a' },
        fillEnd: { light: '#0a0a0a', dark: '#fafafa' },
        ink: { light: '#0a0a0a', dark: '#fafafa' },
      },
    });

    act(() => draft.reset());
    expect(draft.draft.lightTone).toBeNull();
    expect(draft.draft.darkColors).toEqual(emptyDarkColors());
    expect(draft.draft.fontColors).toEqual(emptyFontColors());
    expect(draft.draft.buttonColors).toEqual(emptyButtonColors());
    expect(preview.tenant).toMatchObject({
      lightTone: null,
      darkColors: emptyDarkColors(),
      fontColors: emptyFontColors(),
      buttonColors: emptyButtonColors(),
    });
  });

  it('4. a step with the created tenant’s id publishes nothing', () => {
    route.params = { id: '7f1c2b9e-4a7d-4c1e-9b3a-2d5e8f6a1c0b' };
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lightTone: 'agua',
        buttonColors: { fill: { light: '#e3af3f', dark: null }, ink: { light: null, dark: null } },
      }),
    );
    mount();
    expect(draft.draft.lightTone).toBe('agua');
    expect(draft.draft.buttonColors.fill.light).toBe('#e3af3f');
    expect(preview.source).toBe('empty');
    expect(preview.tenant.lightTone).toBeUndefined();
    expect(preview.tenant.buttonColors).toBeUndefined();
  });

  it('5. hands the look to its cards through the look context, the very draft and update', () => {
    let look: ReturnType<typeof useBrandLook> | null = null;
    function LookProbe() {
      look = useBrandLook();
      return null;
    }
    render(
      <TenantPreviewProvider initialTheme="light">
        <TenantDraftProvider moduleKeys={['feed']}>
          <Probe />
          <LookProbe />
        </TenantDraftProvider>
      </TenantPreviewProvider>,
    );
    expect(look).not.toBeNull();
    const current = look as unknown as ReturnType<typeof useBrandLook>;
    expect(current.draft).toBe(draft.draft);
    expect(current.update).toBe(draft.update);
    act(() => current.update({ lightTone: 'lilas' }));
    expect(draft.draft.lightTone).toBe('lilas');
  });

  it('6. keeps the app icon’s choices in memory only, and reset clears them', () => {
    mount();
    expect(draft.appIcon).toBeNull();
    const art = new File([new Uint8Array(8)], 'arte.png', { type: 'image/png' });
    const appIcon = {
      settings: { ...DEFAULT_APP_ICON_SETTINGS, mode: 'art' as const, art },
      primary: '#2e6fd0',
    };
    act(() => draft.setAppIcon(appIcon));
    expect(draft.appIcon).toBe(appIcon);

    // The tab's mirror holds the text draft alone: the choices (and their files) never reach it.
    act(() => draft.update({ displayName: 'Com ícone' }));
    expect(stored()).toMatchObject({ displayName: 'Com ícone' });
    expect(stored()).not.toHaveProperty('appIcon');

    act(() => draft.reset());
    expect(draft.appIcon).toBeNull();
  });
});

/**
 * 09.2-18 (UI-D-533): the Supabase project's ref joins the persisted draft. It is not secret, so a
 * reload keeps it, and the later steps stay closed until "Continuar" checks it again.
 */
describe('TenantDraftProvider — the project ref', () => {
  it('starts empty and unchecked', () => {
    mount();
    expect(draft.draft.projectRef).toBe('');
    expect(draft.draft.manualAccess).toBe(false);
    expect(draft.draft.dataReady).toBe(false);
  });

  it('mirrors the ref into the tab’s session and reads it back after a reload', () => {
    const first = mount();
    act(() => draft.update({ projectRef: 'abcdefghijklmnopqrst', dataReady: true }));
    expect(stored()).toMatchObject({ projectRef: 'abcdefghijklmnopqrst', dataReady: true });
    first.unmount();
    mount();
    expect(draft.draft.projectRef).toBe('abcdefghijklmnopqrst');
  });

  it('reads a draft stored before the ref existed as an empty one', () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ displayName: 'Antigo' }));
    mount();
    expect(draft.draft.displayName).toBe('Antigo');
    expect(draft.draft.projectRef).toBe('');
  });

  it('keeps only a string ref from storage', () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ projectRef: 42 }));
    mount();
    expect(draft.draft.projectRef).toBe('');
  });

  it('reset clears the ref with the rest', () => {
    mount();
    act(() => draft.update({ projectRef: 'abcdefghijklmnopqrst' }));
    act(() => draft.reset());
    expect(draft.draft.projectRef).toBe('');
    // The mirror holds the empty draft again, never the old ref.
    expect(stored()).toMatchObject({ projectRef: '', dataReady: false });
  });
});

/**
 * 09.2-18 (UI-D-534, D-539, PR-4a): the manual access is write-only and memory only. The tab's mirror
 * is an allow-list of keys, so even a secret smuggled into the draft object never reaches it, and a
 * reload finds the ref and the manual flag but none of the values.
 */
describe('TenantDraftProvider — the manual access (memory only)', () => {
  const SECRETS = {
    databasePassword: 'pw-s3cr3t-0001',
    serviceKey: 'svc-s3cr3t-0002',
    publishableKey: 'pub-s3cr3t-0003',
  };
  const mirror = () => window.sessionStorage.getItem(STORAGE_KEY) ?? '';

  it('starts empty and holds what setAccess is given, field by field', () => {
    mount();
    expect(draft.access).toEqual({ databasePassword: '', serviceKey: '', publishableKey: '' });
    act(() => draft.setAccess({ serviceKey: SECRETS.serviceKey }));
    act(() => draft.setAccess({ databasePassword: SECRETS.databasePassword }));
    expect(draft.access).toEqual({
      databasePassword: SECRETS.databasePassword,
      serviceKey: SECRETS.serviceKey,
      publishableKey: '',
    });
  });

  it('never writes a value to the tab’s session, serialised and scanned', () => {
    mount();
    act(() => {
      draft.setAccess(SECRETS);
      draft.update({ projectRef: 'abcdefghijklmnopqrst', manualAccess: true, dataReady: true });
    });
    expect(draft.access).toEqual(SECRETS);
    const raw = mirror();
    expect(JSON.parse(raw)).toMatchObject({
      projectRef: 'abcdefghijklmnopqrst',
      manualAccess: true,
    });
    for (const secret of Object.values(SECRETS)) expect(raw).not.toContain(secret);
    for (const key of Object.keys(SECRETS)) expect(raw).not.toContain(key);
    // Nor anywhere else the browser keeps text across a reload.
    expect(JSON.stringify(window.localStorage)).not.toContain('s3cr3t');
    expect(document.cookie).not.toContain('s3cr3t');
  });

  it('persists an allow-list of keys: a field added to the draft later is not mirrored until listed', () => {
    mount();
    act(() => draft.update({ displayName: 'Lista' }));
    // A foreign key (a secret added by mistake, say) rides in the object but not in the mirror.
    act(() => draft.update({ leaked: 'pw-s3cr3t' } as never));
    expect(stored()).toMatchObject({ displayName: 'Lista' });
    expect(mirror()).not.toContain('leaked');
    expect(mirror()).not.toContain('s3cr3t');
  });

  it('a reload yields the ref and the flag, with no values', () => {
    const first = mount();
    act(() => {
      draft.setAccess(SECRETS);
      draft.update({ projectRef: 'abcdefghijklmnopqrst', manualAccess: true });
    });
    first.unmount();
    mount();
    expect(draft.draft.projectRef).toBe('abcdefghijklmnopqrst');
    expect(draft.draft.manualAccess).toBe(true);
    expect(draft.access).toEqual({ databasePassword: '', serviceKey: '', publishableKey: '' });
  });

  it('a stored secret planted under the draft’s keys is ignored on reload', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ projectRef: 'abcdefghijklmnopqrst', access: SECRETS, ...SECRETS }),
    );
    mount();
    expect(draft.access).toEqual({ databasePassword: '', serviceKey: '', publishableKey: '' });
    expect(Object.keys(draft.draft)).not.toContain('databasePassword');
    expect(mirror()).not.toContain('s3cr3t');
  });

  it('clearAccess empties the three after the creation answered', () => {
    mount();
    act(() => draft.setAccess(SECRETS));
    act(() => draft.clearAccess());
    expect(draft.access).toEqual({ databasePassword: '', serviceKey: '', publishableKey: '' });
  });

  it('reset (a discarded draft) clears the values with the rest', () => {
    mount();
    act(() => {
      draft.setAccess(SECRETS);
      draft.update({ projectRef: 'abcdefghijklmnopqrst', manualAccess: true });
    });
    act(() => draft.reset());
    expect(draft.access).toEqual({ databasePassword: '', serviceKey: '', publishableKey: '' });
    expect(draft.draft.manualAccess).toBe(false);
    expect(mirror()).not.toContain('abcdefghijklmnopqrst');
  });
});

/**
 * 09.4-15 Task 1 (UI-D-550, UI-D-561, A-UI-2, T-09.4-53): the customer project. The owner and the typed
 * expiry are plain data and join the persisted draft; the project token is a write-only secret and
 * lives in the provider's MEMORY only, never in the tab's session mirror.
 */
describe('TenantDraftProvider — the customer project token', () => {
  const TOKEN = 'sbp_s3cr3t-token-0001';
  const mirror = () => window.sessionStorage.getItem(STORAGE_KEY) ?? '';

  it('starts as a platform project with no expiry and no token', () => {
    mount();
    expect(draft.draft.owner).toBe('platform');
    expect(draft.draft.tokenExpiresAt).toBe('');
    expect(draft.token).toBe('');
  });

  it('persists the owner and the expiry but NOT the token (a scan of every stored string)', () => {
    mount();
    act(() => {
      draft.update({
        owner: 'customer',
        tokenExpiresAt: '2027-03-01',
        projectRef: 'abcdefghijklmnopqrst',
      });
      draft.setToken(TOKEN);
    });
    expect(stored().owner).toBe('customer');
    expect(stored().tokenExpiresAt).toBe('2027-03-01');
    expect(Object.keys(stored())).not.toContain('token');
    expect(mirror()).not.toContain('s3cr3t');
    expect(mirror()).not.toContain(TOKEN);
  });

  it('a reload restores the owner, the ref and the date, and the token is empty', () => {
    const first = mount();
    act(() => {
      draft.update({
        owner: 'customer',
        tokenExpiresAt: '2027-03-01',
        projectRef: 'abcdefghijklmnopqrst',
      });
      draft.setToken(TOKEN);
    });
    first.unmount();
    mount();
    expect(draft.draft.owner).toBe('customer');
    expect(draft.draft.projectRef).toBe('abcdefghijklmnopqrst');
    expect(draft.draft.tokenExpiresAt).toBe('2027-03-01');
    expect(draft.token).toBe('');
  });

  it('a stored token planted under the draft’s keys is ignored, and an unknown owner reads as the platform', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ owner: 'someone', token: TOKEN, tokenExpiresAt: 42 }),
    );
    mount();
    expect(draft.draft.owner).toBe('platform');
    expect(draft.draft.tokenExpiresAt).toBe('');
    expect(draft.token).toBe('');
    expect(Object.keys(draft.draft)).not.toContain('token');
    expect(mirror()).not.toContain('s3cr3t');
  });

  it('clearToken empties it after the creation answered', () => {
    mount();
    act(() => draft.setToken(TOKEN));
    expect(draft.token).toBe(TOKEN);
    act(() => draft.clearToken());
    expect(draft.token).toBe('');
  });

  it('reset (a discarded draft) clears the token and the owner with the rest', () => {
    mount();
    act(() => {
      draft.setToken(TOKEN);
      draft.update({ owner: 'customer', tokenExpiresAt: '2027-03-01' });
    });
    act(() => draft.reset());
    expect(draft.token).toBe('');
    expect(draft.draft.owner).toBe('platform');
    expect(draft.draft.tokenExpiresAt).toBe('');
    expect(mirror()).not.toContain('2027-03-01');
  });
});

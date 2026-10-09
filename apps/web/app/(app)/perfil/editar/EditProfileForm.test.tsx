// @vitest-environment happy-dom
import type { AdminIconId } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-06 — "Ícone ao lado do nome" on "Editar perfil", against the REAL `profile.json` catalog.
 * Stubbed: the router, the toast and the photo block (it uploads on its own). Real: the form, the
 * picker, `SelectMenu` and the `@rede-social/ui` badge.
 *
 * Claims:
 *  1. a member who is not an administrator never sees the field;
 *  2. an administrator sees ONE choice menu whose trigger is the preview (the name with the current
 *     icon), named by the label and the icon's name; the list stays closed until the trigger is
 *     pressed, then shows the ten icons by name, the current one selected; the form starts clean;
 *  3. a new pick closes the list, updates the preview and makes the form dirty; saving sends ONLY
 *     the icon when only the icon changed, then says "saved" and goes back to the profile;
 *  4. a changed name AND icon saves the profile first, then the icon;
 *  5. a refused profile never saves the icon; a refused icon stays on the form with the error toast.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { catalog, toast, push } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return {
    catalog: JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profile.json'), 'utf8'),
    ).profile as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    push: vi.fn(),
  };
});

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: () => lookup,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('@/components/media/AvatarUploadField', () => ({
  AvatarUploadField: () => null,
}));

const { EditProfileForm } = await import('./EditProfileForm');

const names = (catalog.edit as { adminIcon: { names: Record<AdminIconId, string> } }).adminIcon
  .names;
const SAVE = lookup('edit.save');
const LABEL = lookup('edit.adminIcon.label');

function setup(adminIcon: 'crown' | 'star' | null = 'crown') {
  const save = vi.fn().mockResolvedValue({ ok: true });
  const saveAdminIcon = vi.fn().mockResolvedValue({ ok: true });
  render(
    <EditProfileForm
      displayName="Admin Rede Lab"
      bio={null}
      avatarAssetId={null}
      save={save}
      adminIcon={adminIcon}
      adminLabel="Administrador"
      saveAdminIcon={saveAdminIcon}
    />,
  );
  const button = () => screen.getByRole('button', { name: SAVE }) as HTMLButtonElement;
  const menu = () => screen.getByRole('combobox');
  const preview = () =>
    document.querySelector('[data-admin-icon-preview] [data-admin-badge]') as HTMLElement | null;
  /** Opens the menu from its trigger (the preview) and picks the icon named `name`. */
  const pick = (name: string) => {
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole('option', { name }));
  };
  return { save, saveAdminIcon, button, menu, preview, pick };
}

beforeEach(() => {
  toast.show.mockReset();
  push.mockReset();
});
afterEach(cleanup);

describe('EditProfileForm — the administrator icon (2026-10-06)', () => {
  it('1. a member who is not an administrator never sees the field', () => {
    const { button } = setup(null);
    expect(document.querySelector('[data-admin-icon-picker]')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(button().disabled).toBe(true);
  });

  it('2. one choice menu: the preview is the trigger, the list opens on a press', () => {
    const { button, menu, preview } = setup('crown');
    // The trigger shows the preview: the name with the current icon beside it.
    expect(menu().contains(preview())).toBe(true);
    expect(preview()?.getAttribute('data-admin-badge')).toBe('crown');
    expect(menu().textContent).toContain('Admin Rede Lab');
    // Named by the label, then the value, as a select reads.
    const [labelId, valueId] = (menu().getAttribute('aria-labelledby') ?? '').split(' ');
    expect(document.getElementById(labelId ?? '')?.textContent).toBe(LABEL);
    expect(document.getElementById(valueId ?? '')?.textContent).toBe(names.crown);
    expect(menu().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(lookup('edit.adminIcon.hint'))).toBeTruthy();
    expect(button().disabled).toBe(true);

    fireEvent.click(menu());
    expect(menu().getAttribute('aria-expanded')).toBe('true');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(Object.values(names));
    expect(screen.getByRole('option', { name: names.crown }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // Each option draws its own icon.
    expect(
      document.querySelector('[data-admin-icon-option="heart"] svg[data-admin-icon="heart"]'),
    ).not.toBeNull();
  });

  it('3. a new pick: the list closes, the preview follows, and only the icon is saved', async () => {
    const { save, saveAdminIcon, button, menu, preview, pick } = setup('crown');
    pick(names.star);
    expect(menu().getAttribute('aria-expanded')).toBe('false');
    expect(preview()?.getAttribute('data-admin-badge')).toBe('star');
    expect(menu().textContent).toContain(names.star);
    expect(button().disabled).toBe(false);

    fireEvent.click(button());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/perfil'));
    expect(save).not.toHaveBeenCalled();
    expect(saveAdminIcon).toHaveBeenCalledWith('star');
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: lookup('toasts.saved') });
  });

  it('3b. picking the current icon again leaves the form clean', () => {
    const { button, pick } = setup('star');
    pick(names.gem);
    pick(names.star);
    expect(button().disabled).toBe(true);
  });

  it('4. a changed name and icon: the profile first, then the icon', async () => {
    const { save, saveAdminIcon, button, pick } = setup('crown');
    fireEvent.change(screen.getByLabelText(lookup('edit.name.label')), {
      target: { value: 'Ana Admin' },
    });
    pick(names.trophy);
    fireEvent.click(button());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/perfil'));
    expect(save).toHaveBeenCalledWith({ displayName: 'Ana Admin', bio: '' });
    expect(saveAdminIcon).toHaveBeenCalledWith('trophy');
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      saveAdminIcon.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('5. a refused profile never saves the icon; a refused icon stays with the error toast', async () => {
    const first = setup('crown');
    first.save.mockResolvedValueOnce({ ok: false, code: 'generic' });
    fireEvent.change(screen.getByLabelText(lookup('edit.name.label')), {
      target: { value: 'Ana Admin' },
    });
    first.pick(names.heart);
    fireEvent.click(first.button());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: lookup('errors.generic'),
      }),
    );
    expect(first.saveAdminIcon).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    cleanup();
    toast.show.mockReset();

    const second = setup('crown');
    second.saveAdminIcon.mockResolvedValueOnce({ ok: false, code: 'generic' });
    second.pick(names.bolt);
    fireEvent.click(second.button());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: lookup('errors.generic'),
      }),
    );
    expect(push).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-09 — "Instagram", stored as the bio's last line (`lib/profile-instagram.ts`). Claims:
 *
 *  6. the field sits between "Nome" and "Bio", described by its hint, with the attributes a handle
 *     needs (no capitalisation, no correction); without a handle the bio keeps its 150;
 *  7. a handle shrinks the bio's counter and cap by its line, live;
 *  8. a pasted profile link becomes the handle on blur;
 *  9. saving sends the COMPOSED bio (the text, a blank line, `Instagram: @handle`);
 * 10. a value that is not a handle is announced, and nothing is saved;
 * 11. clearing the field saves the visible bio alone;
 * 12. a bio longer than the room the handle leaves is refused with that room in the message;
 * 13. the stored handle, typed again with its `@`, leaves the form clean.
 */
describe('EditProfileForm — the Instagram @ (2026-10-09)', () => {
  const HANDLE = 'ana.souza';
  /** 150 minus the blank line, `Instagram: @` and the handle. */
  const ROOM = 150 - 2 - 12 - HANDLE.length;

  function setupInstagram({
    bio = null,
    instagram = null,
  }: {
    bio?: string | null;
    instagram?: string | null;
  } = {}) {
    const save = vi.fn().mockResolvedValue({ ok: true });
    render(
      <EditProfileForm
        displayName="Ana Souza"
        bio={bio}
        instagram={instagram}
        avatarAssetId={null}
        save={save}
      />,
    );
    const field = () => screen.getByLabelText(lookup('edit.instagram.label')) as HTMLInputElement;
    const bioField = () => screen.getByLabelText(lookup('edit.bio.label')) as HTMLTextAreaElement;
    const counter = () => document.getElementById('bio-counter')?.textContent;
    const button = () => screen.getByRole('button', { name: SAVE }) as HTMLButtonElement;
    const type = (element: HTMLElement, value: string) =>
      fireEvent.change(element, { target: { value } });
    return { save, field, bioField, counter, button, type };
  }

  it('6. sits between Nome and Bio, described by its hint; no handle keeps the 150', () => {
    const { field, bioField, counter } = setupInstagram();
    const ids = Array.from(document.querySelectorAll('input, textarea')).map((el) => el.id);
    expect(ids.indexOf('instagram')).toBe(ids.indexOf('displayName') + 1);
    expect(ids.indexOf('bio')).toBe(ids.indexOf('instagram') + 1);

    const input = field();
    expect(input.getAttribute('placeholder')).toBe(lookup('edit.instagram.placeholder'));
    expect(input.getAttribute('maxlength')).toBe('200');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBe('instagram-hint');
    expect(document.getElementById('instagram-hint')?.textContent).toBe(
      lookup('edit.instagram.hint'),
    );

    expect(counter()).toBe('0/150');
    expect(bioField().getAttribute('maxlength')).toBe('150');
  });

  it('7. a handle shrinks the bio’s counter and cap by its line, live', () => {
    const { field, bioField, counter, type } = setupInstagram();
    type(field(), HANDLE);
    expect(counter()).toBe(`0/${ROOM}`);
    expect(bioField().getAttribute('maxlength')).toBe(String(ROOM));
    type(field(), '');
    expect(counter()).toBe('0/150');
  });

  it('8. a pasted profile link becomes the handle on blur', () => {
    const { field, counter, type } = setupInstagram();
    type(field(), 'https://www.instagram.com/Ana.Souza/?igsh=MWx0aDZ1ZzQ=');
    // The link already counts as the handle it holds.
    expect(counter()).toBe(`0/${ROOM}`);
    fireEvent.blur(field());
    expect(field().value).toBe(HANDLE);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('9. saving sends the composed bio, then goes back to the profile', async () => {
    const { save, field, bioField, button, type } = setupInstagram();
    type(bioField(), 'Corro aos domingos.');
    type(field(), `@${HANDLE}`);
    fireEvent.click(button());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/perfil'));
    expect(save).toHaveBeenCalledWith({
      displayName: 'Ana Souza',
      bio: `Corro aos domingos.\n\nInstagram: @${HANDLE}`,
    });
  });

  it('9b. a handle with no text is the whole bio', async () => {
    const { save, field, button, type } = setupInstagram();
    type(field(), HANDLE);
    fireEvent.click(button());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      displayName: 'Ana Souza',
      bio: `Instagram: @${HANDLE}`,
    });
  });

  it('10. a value that is not a handle is announced, and nothing is saved', async () => {
    const { save, field, button, type } = setupInstagram({ bio: 'Corro.' });
    const message = lookup('errors.instagramInvalid', { max: 30 });

    type(field(), 'ana..souza');
    fireEvent.blur(field());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(alert.id).toBe('instagram-error');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe('instagram-hint instagram-error');

    // Typing clears it; submitting the same mistake raises it again, and nothing is sent.
    type(field(), 'ana souza');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
    expect(save).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('11. clearing the field saves the visible bio alone', async () => {
    const { save, field, counter, button, type } = setupInstagram({
      bio: 'Corro.',
      instagram: HANDLE,
    });
    expect(field().value).toBe(HANDLE);
    expect(counter()).toBe(`6/${ROOM}`);
    type(field(), '');
    expect(counter()).toBe('6/150');
    fireEvent.click(button());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ displayName: 'Ana Souza', bio: 'Corro.' });
  });

  it('12. a bio longer than the room the handle leaves is refused, with that room', async () => {
    const { save, field, bioField, counter, button, type } = setupInstagram({
      bio: 'a'.repeat(140),
    });
    type(field(), HANDLE);
    expect(counter()).toBe(`140/${ROOM}`);
    // The cap never drops below the text already there, so the browser does not block the submit
    // with its own bubble: the form's message below says how much room is left.
    expect(bioField().getAttribute('maxlength')).toBe('140');
    fireEvent.click(button());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        lookup('errors.bioTooLongWithInstagram', { max: ROOM }),
      ),
    );
    expect(screen.getByRole('alert').id).toBe('bio-error');
    expect(save).not.toHaveBeenCalled();
  });

  it('12b. a Bio whose text ends with an Instagram line is refused: it would read back as the @', async () => {
    const { save, field, bioField, button, type } = setupInstagram({
      bio: 'Corro.',
      instagram: HANDLE,
    });
    // The member clears the field but leaves the line in the Bio's own text.
    type(field(), '');
    type(bioField(), 'Loja da Ana\n\nInstagram: @lojadaana');
    fireEvent.click(button());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(lookup('errors.bioInstagramLine')),
    );
    expect(screen.getByRole('alert').id).toBe('bio-error');
    expect(save).not.toHaveBeenCalled();

    // The line alone is refused the same way; any other text that mentions Instagram is not.
    type(bioField(), 'Instagram: @lojadaana');
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('alert').id).toBe('bio-error'));
    expect(save).not.toHaveBeenCalled();

    type(bioField(), 'Me siga no Instagram: @lojadaana, posto todo dia.');
    fireEvent.click(button());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('13. the stored handle typed again with its @ leaves the form clean', () => {
    const { field, button, type } = setupInstagram({ bio: 'Corro.', instagram: HANDLE });
    expect(button().disabled).toBe(true);
    type(field(), `@${HANDLE.toUpperCase()}`);
    expect(button().disabled).toBe(true);
    type(field(), 'outro.perfil');
    expect(button().disabled).toBe(false);
  });
});

import { MAX_BIO_LENGTH, normaliseBio } from '@rede-social/contracts/profiles';

/**
 * 2026-10-09 — the member's Instagram handle (`@seuperfil`), shown under their name on the profile
 * and on every post and Reel they author, stored INSIDE the one `bio` string the profile contract
 * already carries (`MAX_BIO_LENGTH`, 150). Front-only on purpose, the `event-extras.ts` precedent:
 * the API, the contract and the column stay a free string, so this module IS the whole convention.
 * Pure (no `'use client'`): the edit form composes with it, the screens and the server readers
 * (`author-instagram.ts`) split with it.
 *
 * **The line is human-readable**, so a surface that prints the bio raw still reads well. It closes
 * the bio after a blank line, or is the whole bio when there is no text:
 *
 *   {the bio}
 *
 *   Instagram: @seuperfil
 *
 * The API's `normaliseBio` (CRLF to LF, three or more line breaks to two, trimmed, empty to null)
 * keeps a composed bio byte for byte, and its 150-unit cap counts the line too: `bioRoom` is what
 * the line leaves for the text.
 *
 * **Parsing is an exact round trip.** `splitProfileBio` accepts the line only when the handle is
 * valid AND composing what it read gives the SAME string back; anything else is plain bio text,
 * which is what every bio written before this format holds.
 *
 * **The handle has Instagram's own shape**: 1 to 30 lowercase letters, digits, periods and
 * underscores, never a period first, last or twice in a row. The input is forgiving: a pasted
 * profile link (`instagram.com`, `www.`, `m.` or `instagr.am`, with or without `@`, a trailing slash
 * or a tracking query) becomes its handle, one leading `@` is dropped and the case is folded. A post
 * or Reel link (`/p/…`, `/reel/…`) is not a profile, so it stays invalid.
 *
 * The prefix and the separator are a STORAGE format, so they live here and never in the catalog: a
 * copy edit must not orphan the handles already stored.
 */

/** Instagram's own cap on a handle. */
export const INSTAGRAM_HANDLE_MAX = 30;

/**
 * The field's `maxLength`: room for a pasted profile link with its tracking query, which the field
 * reduces to the handle on blur. What is stored never exceeds `INSTAGRAM_HANDLE_MAX`.
 */
export const INSTAGRAM_INPUT_MAX_LENGTH = 200;

const PREFIX = 'Instagram: @';
const SEPARATOR = '\n\n';

/** 1 to 30 (`INSTAGRAM_HANDLE_MAX`) of `a-z`, `0-9`, `.` and `_`; no `.` first, last or twice. */
const HANDLE_RE = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/;

/**
 * A profile link: an optional scheme, `instagram.com` (bare, `www.` or `m.`) or `instagr.am`, ONE
 * path segment (the handle, optionally after `@`), an optional trailing slash and an optional query
 * or fragment (`?igsh=…`, `?hl=pt-br`). The paths Instagram keeps for itself are not profiles.
 */
const URL_RE =
  /^(?:https?:\/\/)?(?:(?:www|m)\.)?(?:instagram\.com|instagr\.am)\/(?!(?:p|reel|reels|tv|stories|explore|accounts|direct)(?:[/?#]|$))@?([^/?#\s]+)\/?(?:[?#]\S*)?$/i;

/** The `@handle` link a profile header, a post header and a Reel render. */
export type InstagramLink = {
  /** `@seuperfil`. */
  label: string;
  /** `https://instagram.com/seuperfil`. */
  href: string;
  /** The link's accessible name, from the catalog ("Ver @seuperfil no Instagram"). */
  ariaLabel: string;
};

/** Each author's handle by `membershipId`; an author without one is absent. */
export type InstagramByMember = ReadonlyMap<string, string>;

/** What the field holds: nothing, a valid handle, or a candidate that is not one. */
export type InstagramInput =
  | { status: 'empty' }
  | { status: 'valid'; handle: string }
  | { status: 'invalid'; candidate: string };

/** A stored bio, split: the text the screens show and the handle, `null` for none. */
export type ProfileBio = { text: string; instagram: string | null };

/** Whether `value` is a handle as stored (already lowercase, no `@`). */
export function isInstagramHandle(value: string): boolean {
  return HANDLE_RE.test(value);
}

/** What the field holds, reduced to a handle: trimmed, a link's segment, one `@` off, lowercase. */
export function cleanInstagramInput(raw: string): string {
  const trimmed = raw.trim();
  const value = URL_RE.exec(trimmed)?.[1] ?? trimmed;
  return (value.startsWith('@') ? value.slice(1) : value).toLowerCase();
}

/** The field's value, read: empty, a valid handle, or the cleaned candidate that is not one. */
export function parseInstagramInput(raw: string): InstagramInput {
  const candidate = cleanInstagramInput(raw);
  if (candidate === '') return { status: 'empty' };
  return isInstagramHandle(candidate)
    ? { status: 'valid', handle: candidate }
    : { status: 'invalid', candidate };
}

/**
 * What the Instagram line takes out of the bio's 150 units: nothing without a handle, else the blank
 * line, the prefix and the handle (2 + 12 + its length). A candidate still being fixed counts at most
 * `INSTAGRAM_HANDLE_MAX`, so the room never falls below what the longest valid handle leaves (106).
 */
export function instagramCost(handle: string | null): number {
  if (handle === null || handle === '') return 0;
  return SEPARATOR.length + PREFIX.length + Math.min(handle.length, INSTAGRAM_HANDLE_MAX);
}

/** The most the bio's text may hold beside `handle`: `MAX_BIO_LENGTH` without one. */
export function bioRoom(handle: string | null): number {
  return MAX_BIO_LENGTH - instagramCost(handle);
}

/**
 * The bio as stored: the text, normalised the way the API stores it, then the Instagram line after a
 * blank line, or the line alone when there is no text. No handle, or one that is not valid, stores
 * the text alone. A non-empty result is a fixed point of `normaliseBio`, so the API keeps it as it is;
 * `''` is "no bio", which the API stores as null.
 */
export function composeProfileBio(text: string, handle: string | null): string {
  const body = normaliseBio(text) ?? '';
  if (handle === null || !isInstagramHandle(handle)) return body;
  const line = `${PREFIX}${handle}`;
  return body === '' ? line : `${body}${SEPARATOR}${line}`;
}

/**
 * The stored bio → the text the screens show and the handle, or `instagram: null` when there is no
 * line (or what looks like one is not an exact round trip: then it all stays text). `null` (no bio)
 * is the empty text.
 */
export function splitProfileBio(stored: string | null): ProfileBio {
  if (stored === null) return { text: '', instagram: null };
  const candidates: { text: string; handle: string }[] = [];
  const at = stored.lastIndexOf(`${SEPARATOR}${PREFIX}`);
  if (at >= 0) {
    candidates.push({
      text: stored.slice(0, at),
      handle: stored.slice(at + SEPARATOR.length + PREFIX.length),
    });
  }
  // No text at all: the line is the whole bio.
  if (stored.startsWith(PREFIX)) candidates.push({ text: '', handle: stored.slice(PREFIX.length) });
  for (const { text, handle } of candidates) {
    // Exact round trip, or it is not ours.
    if (isInstagramHandle(handle) && composeProfileBio(text, handle) === stored) {
      return { text, instagram: handle };
    }
  }
  return { text: stored, instagram: null };
}

/**
 * The directory row's second line (UI-D-02): the visible bio's FIRST line, else the `@handle`, else
 * nothing. Never the stored Instagram line itself.
 */
export function profileRowSnippet(stored: string | null): string | null {
  const { text, instagram } = splitProfileBio(stored);
  const line = text.split('\n', 1)[0]?.trim() ?? '';
  if (line !== '') return line;
  return instagram === null ? null : instagramLabel(instagram);
}

/** `@seuperfil`, the text every surface prints. */
export function instagramLabel(handle: string): string {
  return `@${handle}`;
}

/**
 * The profile's address on Instagram. Built ONLY from a validated handle (`a-z`, `0-9`, `.`, `_`),
 * which is why it needs no escaping.
 */
export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle}`;
}

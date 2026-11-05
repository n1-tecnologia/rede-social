import { type ModuleKey, TOGGLEABLE_MODULES } from '@rede-social/contracts';

/**
 * The store listing text of a tenant's native app (13-31, D-607, D-604, D-617, NATIVE-29, T-13-56): the store
 * description, the Review Notes for App Review, the questionnaire answers and the cuts that keep every field
 * inside the stores' limits. Everything here is PURE DATA built from the tenant's name and the modules it has
 * on; none of it is UI text, and nothing here reads a database or a secret.
 *
 * Two rules the whole file keeps:
 *  - NOTHING ADVERTISES A PURCHASE (T-13-56, D-617). The description is built from a fixed table that has no
 *    sentence for the `store` or `payments` modules, and the Review Notes say that purchases happen outside the
 *    app and that the app shows no price and no call to action. The purchase switch is OFF in both stores for
 *    the pilot, and turning it on is a decision of a later release, not of this text.
 *  - NO FIELD IS EVER OVER-LENGTH (COVERAGE sections 3 and 4). A field that would exceed its limit is cut at a
 *    word boundary and reported `cut: true`. Characters are counted in Unicode code points; the App Store
 *    keywords are counted in UTF-8 BYTES (the store counts bytes), so a keyword string of 3-byte characters
 *    loses a third of its length.
 */

export type ListingText = { text: string; cut: boolean };
export type CutUnit = 'codepoints' | 'bytes';

/** The limits of both stores, in the unit each store counts in. */
export const STORE_LIMITS = Object.freeze({
  appStoreName: 30,
  appStoreSubtitle: 30,
  appStoreDescription: 4000,
  /** BYTES in UTF-8, not characters. */
  appStoreKeywordsBytes: 100,
  appStoreReviewNotes: 4000,
  playTitle: 30,
  playShortDescription: 80,
  playFullDescription: 4000,
});

/** The closed reasons a builder refuses with. A reason never carries a value. */
export type ListingRefusalCode = 'tenant_name_empty';
export class ListingRefusal extends Error {
  readonly code: ListingRefusalCode;
  constructor(code: ListingRefusalCode) {
    super(code);
    this.name = 'ListingRefusal';
    this.code = code;
  }
}

// --- Cutting --------------------------------------------------------------------------------------------

const isBoundary = (char: string): boolean => char === ',' || /^\s$/u.test(char);

/**
 * Cuts `text` to at most `max` of `unit`, at a word boundary (a space or a comma) when there is one inside the
 * kept part, and otherwise at the last whole code point that fits. A string that fits is returned untouched
 * with `cut: false`. A code point is never split, so no half of an emoji or an accented letter survives.
 */
export function cutToLimit(text: string, limit: { unit: CutUnit; max: number }): ListingText {
  const width = (char: string): number =>
    limit.unit === 'bytes' ? Buffer.byteLength(char, 'utf8') : 1;
  const all = Array.from(text);
  if (all.reduce((sum, char) => sum + width(char), 0) <= limit.max) return { text, cut: false };

  let used = 0;
  let keep = 0;
  while (keep < all.length) {
    const next = width(all[keep] as string);
    if (used + next > limit.max) break;
    used += next;
    keep += 1;
  }
  // The cut lands on a boundary already when the next character is one; otherwise step back to the last
  // boundary inside the kept part, so a word is never left in half.
  if (keep < all.length && !isBoundary(all[keep] as string)) {
    for (let index = keep - 1; index > 0; index -= 1) {
      if (isBoundary(all[index] as string)) {
        keep = index;
        break;
      }
    }
  }
  const head = all.slice(0, keep).join('');
  return { text: head.replace(/[\s,]+$/u, ''), cut: true };
}

const cutPoints = (text: string, max: number): ListingText =>
  cutToLimit(text, { unit: 'codepoints', max });

// --- The tenant name ------------------------------------------------------------------------------------

/** Every control character, DEL, the C1 controls and the line and paragraph separators. */
const isControl = (code: number): boolean =>
  code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;

/**
 * The name as it is printed in a store field: control characters become spaces, runs of white space collapse to
 * one, the ends are trimmed. A name that is empty after that is refused (`tenant_name_empty`): a listing with no
 * name is never built. Accents and emoji pass through untouched.
 */
export function cleanTenantName(raw: string): string {
  const spaced = Array.from(typeof raw === 'string' ? raw : '')
    .map((char) => (isControl(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('');
  const name = spaced.replace(/\s+/gu, ' ').trim();
  if (name === '') throw new ListingRefusal('tenant_name_empty');
  return name;
}

/** Replaces every `{tenant}` in one pass, so a name that itself contains the placeholder is never re-expanded. */
const fill = (template: string, name: string): string =>
  template.replaceAll('{tenant}', () => name);

// --- The description ------------------------------------------------------------------------------------

/** The UI-SPEC standard text ("Standard store description"), `{tenant}` = the tenant's name. */
const BASE_DESCRIPTION =
  'Entre na comunidade de {tenant} direto do seu celular. Veja as novidades, curta e comente as publicações, participe de comunidades e eventos, converse com a equipe e receba avisos do que importa. Seu acesso é o mesmo da comunidade de {tenant} na web.';

/**
 * One sentence per module, keyed by the contracts' module keys. A module with no entry adds nothing: `feed` is
 * already what the base text says, and `store`, `payments` and `social` have no sentence ON PURPOSE (T-13-56:
 * nothing in the listing may speak of buying, prices or a store).
 */
const MODULE_SENTENCES: Readonly<Partial<Record<ModuleKey, string>>> = {
  communities: 'Entre nas comunidades e acompanhe as conversas de cada uma.',
  stories: 'Assista aos stories e aos destaques da comunidade.',
  events: 'Veja a agenda de eventos, confirme sua presença e faça o check-in.',
  chat: 'Fale com a equipe pelo chat de suporte.',
  notifications: 'Ative as notificações para saber das novidades na hora.',
  reels: 'Assista aos reels em tela cheia.',
  courses: 'Acesse os cursos e acompanhe o seu progresso.',
  profile_form: 'Mantenha o seu perfil completo para a comunidade.',
};

/**
 * The store description: the standard text, then one sentence per enabled module in the contracts' module order
 * (so the same set of modules always gives the same text, whatever order it is passed in). An unknown key and a
 * repeated key add nothing. Cut to 4000 code points at a word boundary.
 */
export function buildStoreDescription(input: {
  tenantName: string;
  modules: readonly string[];
}): ListingText {
  const name = cleanTenantName(input.tenantName);
  const enabled = new Set(input.modules);
  const sentences = TOGGLEABLE_MODULES.filter((key) => enabled.has(key))
    .map((key) => MODULE_SENTENCES[key])
    .filter((sentence): sentence is string => sentence !== undefined);
  const base = fill(BASE_DESCRIPTION, name);
  const text = sentences.length === 0 ? base : `${base}\n\n${sentences.join('\n')}`;
  return cutPoints(text, STORE_LIMITS.appStoreDescription);
}

// --- Keywords, title and short description ------------------------------------------------------------------

const KEYWORD_EXTRAS = ['comunidade', 'membros'] as const;

/**
 * The App Store keyword string: the tenant's own words (lower case, 3 characters or more, no repeats) then two
 * generic ones, joined by commas without spaces, cut to 100 UTF-8 BYTES at a comma.
 */
export function buildKeywords(input: { tenantName: string }): ListingText {
  const name = cleanTenantName(input.tenantName);
  const words: string[] = [];
  for (const word of name.toLowerCase().split(/[\s,]+/u)) {
    if (Array.from(word).length >= 3 && !words.includes(word)) words.push(word);
  }
  for (const extra of KEYWORD_EXTRAS) if (!words.includes(extra)) words.push(extra);
  return cutToLimit(words.join(','), { unit: 'bytes', max: STORE_LIMITS.appStoreKeywordsBytes });
}

/** The Play title (and the App Store name, when it is sent): the tenant's name, at most 30 code points. */
export function buildStoreTitle(name: string): ListingText {
  return cutPoints(cleanTenantName(name), STORE_LIMITS.playTitle);
}

/** The Play short description, at most 80 code points. */
export function buildShortDescription(input: { tenantName: string }): ListingText {
  const name = cleanTenantName(input.tenantName);
  return cutPoints(
    fill('Entre na comunidade de {tenant} pelo celular.', name),
    STORE_LIMITS.playShortDescription,
  );
}

// --- The Review Notes -------------------------------------------------------------------------------------

/** How much of the name the notes repeat: the notes name the app, they are not the place for a long name. */
const NOTES_NAME_MAX = 100;

/**
 * The Review Notes (English, for App Review; D-607, Apple 2.1(a)). The demo account's address and password go in
 * the review detail's own fields, never in this text, which is why the text names no credential. The five
 * statements: how to sign in, that purchases happen outside the app and the app shows no price or call to
 * action, the native features, account deletion with a 14-day grace period, and reporting and blocking with the
 * support chat as the published contact.
 */
const REVIEW_NOTES_TEMPLATE = `Thank you for reviewing the {tenant} app.

1. Signing in. {tenant} is a community app for the members of one organisation. Please sign in with the demo account given in the Demo Account fields of this submission. It is an ordinary member account created for this review, and no sign-up is needed. The app is in Brazilian Portuguese.

2. Purchases. Any purchase or subscription is made outside the app, on the community's own website. The app shows no price, no buy button and no link or other call to action to pay for anything, and it offers no in-app purchase.

3. Native features. The app uses push notifications (the permission is asked only after sign-in and only when the member agrees), an optional Face ID or fingerprint lock (turned on by the member in Settings), the native share sheet, and offline reading of the feed.

4. Account deletion. A member can delete the account inside the app, in Settings (Configurações). The deletion is scheduled with a 14-day grace period, and signing in again within that period cancels it.

5. Safety and contact. A member can report any post or comment and block any member from the content's menu, and the community's team reviews each report. Members reach the team through the support chat inside the app, which is the published contact for this app.`;

/**
 * The Review Notes for `tenantName`. Only the name is interpolated (cleaned of control characters and cut to 100
 * code points), and it is placed in one pass, so a name cannot add text of its own.
 */
export function buildReviewNotes(input: { tenantName: string }): ListingText {
  const name = cutPoints(cleanTenantName(input.tenantName), NOTES_NAME_MAX).text;
  const notes = cutPoints(fill(REVIEW_NOTES_TEMPLATE, name), STORE_LIMITS.appStoreReviewNotes);
  return notes;
}

// --- The questionnaire answers ------------------------------------------------------------------------------

/**
 * The age-rating questionnaire answers (research OQ-3, Finding F12), the same for every tenant. Planner
 * assumption A-13-12: the minimum age 13 and "Unrestricted Web Access = No" are the research's recommended
 * defaults, taken without Igor's answer (research open question 7) and confirmed again at plan 32's decision
 * checkpoint. "Unrestricted Web Access" is NO because the shell is locked to the tenant host and opens any other
 * link in the system browser. A tenant whose terms set a higher minimum age raises it in the store console.
 */
export const AGE_RATING_ANSWERS = Object.freeze({
  userGeneratedContent: true,
  messaging: true,
  unrestrictedWebAccess: false,
  advertising: false,
  parentalControls: false,
  ageAssurance: false,
  minimumAge: 13,
});

/** The read-only value the App tab shows for the age rating. */
export const AGE_RATING_LABEL = `${AGE_RATING_ANSWERS.minimumAge}+`;

/**
 * The Google Play questionnaire answers (content rating and the data-safety basics), entered once per tenant in
 * the Play Console (COVERAGE section 4: the console questionnaires are a manual row). Shown read-only in the App
 * tab so the operator copies the same answers every time.
 */
export const PLAY_QUESTIONNAIRE_ANSWERS = Object.freeze({
  usersInteract: true,
  sharesUserContent: true,
  sharesLocation: false,
  unrestrictedWebAccess: false,
  containsAds: false,
  digitalPurchases: false,
  accountCreation: true,
  accountDeletionInApp: true,
  minimumAge: 13,
});

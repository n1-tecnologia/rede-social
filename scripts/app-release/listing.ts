import {
  AGE_RATING_ANSWERS,
  buildKeywords,
  buildReviewNotes,
  buildShortDescription,
  buildStoreDescription,
  buildStoreTitle,
  ListingRefusal,
} from '@rede-social/core/server/apps/listing';
import { maskValues, secretValuesOf } from './mask';
import { ReleaseRefusal, type Reporter } from './report';
import type { AppleClient } from './store-apple';
import type { GoogleClient } from './store-google';
import { StoreError } from './store-http';
import type { ReadCredential } from './unseal';

/**
 * The listing push (13-31, D-607, D-604, D-617, NATIVE-29, T-13-55, T-13-56): the tenant's store text, age-rating
 * answers and App Review detail go to the stores through the plan 29 clients, and nothing else does.
 *
 *  - App Store Connect: the version localization (description, keywords, support URL), the privacy-policy URL of
 *    the app info, the age-rating declaration answers and the App Review detail (contact, the demo account unsealed
 *    from `reviewer_password`, the Review Notes).
 *  - Google Play: one edit with the listing (title, short and full description), the details (contact e-mail,
 *    website, default language) and the high-resolution icon, then validated and committed.
 *
 * What it never does (COVERAGE OPT-OUT rows): create an app record, upload screenshots, answer the console
 * questionnaires, choose a territory or a charge for the app, or send anything for review. The tenant itself presses the
 * button that sends the app to review (D-619, Apple 4.2.6); no client method of that family exists, so no code
 * path here could call one.
 *
 * It refuses BEFORE any store call, with a closed reason, when a piece is missing: the privacy-policy URL
 * (`privacy_url_missing`), the reviewer account (`reviewer_missing`), the contact (`contact_missing`) or a printable
 * tenant name (`tenant_name_empty`). The demo password is unsealed through the release script's door, masked at
 * once, handed only to the one client call that sets it and never printed.
 */

export const LISTING_LOCALE = 'pt-BR';

/** The people-facing contact the stores publish or hand to App Review. Supplied by the operator. */
export type ListingContact = { email: string; name: string; phone: string };

export type ListingTenant = {
  tenantId: string;
  displayName: string;
  /** The enabled module keys; they shape the description only. */
  modules: readonly string[];
  primaryHost: string;
  privacyUrl: string | null;
  reviewerEmail: string | null;
  reviewerHeld: boolean;
  bundleId: string;
  applicationId: string;
  contact: ListingContact | null;
  /** The 512 px Play icon the build derived from the tenant's brand. */
  playIcon: Buffer | null;
};

export type ListingDeps = {
  /** Reads `reviewer_password` (the kernel's `readAppCredential`). */
  readCredential: ReadCredential;
  maskSink: (line: string) => void;
  report: Reporter;
};

/** The age rating a minimum age maps to in the declaration's override field. */
const OVERRIDE_BY_MINIMUM_AGE: Readonly<Record<number, string>> = {
  9: 'NINE_PLUS',
  13: 'THIRTEEN_PLUS',
  16: 'SIXTEEN_PLUS',
  18: 'EIGHTEEN_PLUS',
};

/** The template answers as the declaration's own attribute names. */
export function ageRatingAttributes(): Record<string, boolean | string> {
  return {
    userGeneratedContent: AGE_RATING_ANSWERS.userGeneratedContent,
    messagingAndChat: AGE_RATING_ANSWERS.messaging,
    unrestrictedWebAccess: AGE_RATING_ANSWERS.unrestrictedWebAccess,
    advertising: AGE_RATING_ANSWERS.advertising,
    parentalControls: AGE_RATING_ANSWERS.parentalControls,
    ageAssurance: AGE_RATING_ANSWERS.ageAssurance,
    ageRatingOverrideV2: OVERRIDE_BY_MINIMUM_AGE[AGE_RATING_ANSWERS.minimumAge] ?? 'NONE',
  };
}

const splitName = (name: string): { first: string; last: string } => {
  const words = name.trim().split(/\s+/u);
  const first = words[0] ?? '';
  return { first, last: words.slice(1).join(' ') || first };
};

/** Every refusal that needs no store call, in the order they are reported. Throws the first. */
function assertComplete(
  tenant: ListingTenant,
  platforms: { apple: boolean; google: boolean },
): void {
  if (tenant.privacyUrl === null || tenant.privacyUrl === '') {
    throw new ReleaseRefusal('privacy_url_missing');
  }
  if (tenant.reviewerEmail === null || !tenant.reviewerHeld) {
    throw new ReleaseRefusal('reviewer_missing');
  }
  const { contact } = tenant;
  const emailOk = contact !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contact.email);
  const appleOk = contact !== null && contact.name.trim() !== '' && contact.phone.trim() !== '';
  if (!emailOk || (platforms.apple && !appleOk)) throw new ReleaseRefusal('contact_missing');
  if (platforms.google && (tenant.playIcon === null || tenant.playIcon.length === 0)) {
    throw new ReleaseRefusal('artifact_missing', ['play-icon.png']);
  }
}

/** Runs one store step; a store failure becomes the closed `store_failed`, reported with the step's name. */
async function storeStep<T>(report: Reporter, name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StoreError) {
      report(name, 'failed', error.code);
      throw new ReleaseRefusal('store_failed');
    }
    throw error;
  }
}

export type PushListingInput = {
  tenant: ListingTenant;
  /** `null` skips the App Store side. */
  apple: AppleClient | null;
  /** `null` skips the Play side. */
  google: GoogleClient | null;
  deps: ListingDeps;
};

export async function pushListing(input: PushListingInput): Promise<void> {
  const { tenant, apple, google, deps } = input;
  const { report } = deps;

  assertComplete(tenant, { apple: apple !== null, google: google !== null });

  let texts: {
    description: string;
    keywords: string;
    notes: string;
    title: string;
    shortDescription: string;
  };
  try {
    texts = {
      description: buildStoreDescription({
        tenantName: tenant.displayName,
        modules: tenant.modules,
      }).text,
      keywords: buildKeywords({ tenantName: tenant.displayName }).text,
      notes: buildReviewNotes({ tenantName: tenant.displayName }).text,
      title: buildStoreTitle(tenant.displayName).text,
      shortDescription: buildShortDescription({ tenantName: tenant.displayName }).text,
    };
  } catch (error) {
    if (error instanceof ListingRefusal) throw new ReleaseRefusal('tenant_name_empty');
    throw error;
  }
  const website = `https://${tenant.primaryHost}`;
  const contact = tenant.contact as ListingContact;
  report('listing.texts', 'ok');

  if (apple) {
    // The demo account's password: unsealed, masked first (a CI runner redacts it from every later line), and
    // passed only to the one call that sets it. It is not kept past this block.
    const password = await deps.readCredential(tenant.tenantId, 'reviewer_password');
    if (password === null) throw new ReleaseRefusal('reviewer_missing');
    maskValues(secretValuesOf(password), deps.maskSink);

    const app = await storeStep(report, 'listing.ios.app-record', () =>
      apple.findApp(tenant.bundleId),
    );
    if (app === null) {
      report('listing.ios.app-record', 'refused', 'app_record_missing');
      throw new ReleaseRefusal('app_record_missing', ['ios']);
    }
    const version = await storeStep(report, 'listing.ios.version', () =>
      apple.findEditableVersion(app.id),
    );
    const info = await storeStep(report, 'listing.ios.app-info', () => apple.findAppInfo(app.id));
    if (version === null || info === null) {
      // The tenant's app version is already in review or released: its text can no longer change from here.
      report('listing.ios', 'skipped', 'no_editable_version');
    } else {
      const localization = await storeStep(report, 'listing.ios.localization', () =>
        apple.upsertVersionLocalization(version.id, {
          locale: LISTING_LOCALE,
          description: texts.description,
          keywords: texts.keywords,
          supportUrl: website,
        }),
      );
      report('listing.ios.localization', localization.created ? 'created' : 'reused');
      const privacy = await storeStep(report, 'listing.ios.privacy', () =>
        apple.upsertAppInfoLocalization(info.id, {
          locale: LISTING_LOCALE,
          name: texts.title,
          privacyPolicyUrl: tenant.privacyUrl as string,
        }),
      );
      report('listing.ios.privacy', privacy.created ? 'created' : 'reused');
      await storeStep(report, 'listing.ios.age-rating', () =>
        apple.setAgeRating(info.id, ageRatingAttributes()),
      );
      report('listing.ios.age-rating', 'ok');
      const { first, last } = splitName(contact.name);
      const detail = await storeStep(report, 'listing.ios.review-detail', () =>
        apple.upsertDemoAccount(version.id, {
          contactFirstName: first,
          contactLastName: last,
          contactPhone: contact.phone.trim(),
          contactEmail: contact.email,
          demoAccountName: tenant.reviewerEmail as string,
          demoAccountPassword: password,
          notes: texts.notes,
        }),
      );
      report('listing.ios.review-detail', detail.created ? 'created' : 'reused');
    }
  }

  if (google) {
    const packageName = tenant.applicationId;
    let editId: string | null = null;
    try {
      editId = (await google.insertEdit(packageName)).id;
      await google.updateListing(packageName, editId, LISTING_LOCALE, {
        title: texts.title,
        shortDescription: texts.shortDescription,
        fullDescription: texts.description,
      });
      report('listing.android.listing', 'ok');
      await google.updateDetails(packageName, editId, {
        contactEmail: contact.email,
        contactWebsite: website,
        defaultLanguage: LISTING_LOCALE,
      });
      report('listing.android.details', 'ok');
      await google.replaceIcon(packageName, editId, LISTING_LOCALE, tenant.playIcon as Buffer);
      report('listing.android.icon', 'ok');
      await google.validateEdit(packageName, editId);
      await google.commitEdit(packageName, editId);
      editId = null;
    } catch (error) {
      if (editId !== null) {
        // An edit left open would hold the next one back; failing to delete it changes nothing here.
        await google.deleteEdit(packageName, editId).catch(() => undefined);
      }
      if (error instanceof StoreError) {
        report('listing.android', 'failed', error.code);
        throw new ReleaseRefusal(
          error.code === 'store_not_found' ? 'app_record_missing' : 'store_failed',
          error.code === 'store_not_found' ? ['android'] : [],
        );
      }
      throw error;
    }
  }
}

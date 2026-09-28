import Link from 'next/link';
import { RulesSheet } from './RulesSheet';

export type ConsentLabels = {
  /** Already interpolated with the tenant name by the caller. */
  acceptRules: string;
  acceptTerms: string;
  viewRules: string;
  /** Already interpolated with the tenant name by the caller. */
  rulesSheetTitle: string;
  closeRules: string;
  termsLink: string;
  privacyLink: string;
};

/**
 * The two D-03 / AUTH-04 consent rows: the tenant's rules (`#acceptRules`, with the "ver regras"
 * sheet) and the platform's terms (`#acceptTerms`, with the legal links). Both unchecked by default, both
 * `required` — the browser refuses the submit without them and the action re-validates (`z.literal(true)`).
 * 44px-tall rows with a 20px brand-accented checkbox and a 14px wrapping label (UI-SPEC). The caller
 * supplies the hidden `rulesVersion` / `termsVersion` inputs and interpolates `{tenant}` into the
 * labels (strings arrive resolved). Shared with `/aceitar-convite` (02-10).
 */
export function ConsentFields({ rulesText, labels }: { rulesText: string; labels: ConsentLabels }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-11 items-start gap-3">
        <input
          id="acceptRules"
          name="acceptRules"
          type="checkbox"
          required
          className="mt-0.5 size-5 shrink-0 rounded border-border accent-brand"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="acceptRules" className="text-sm text-text">
            {labels.acceptRules}
          </label>
          <RulesSheet
            trigger={labels.viewRules}
            title={labels.rulesSheetTitle}
            close={labels.closeRules}
            rulesText={rulesText}
          />
        </div>
      </div>

      <div className="flex min-h-11 items-start gap-3">
        <input
          id="acceptTerms"
          name="acceptTerms"
          type="checkbox"
          required
          className="mt-0.5 size-5 shrink-0 rounded border-border accent-brand"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="acceptTerms" className="text-sm text-text">
            {labels.acceptTerms}
          </label>
          <p className="text-sm text-text-secondary">
            <Link href="/termos" target="_blank" rel="noreferrer" className="font-bold text-brand">
              {labels.termsLink}
            </Link>
            {' · '}
            <Link
              href="/privacidade"
              target="_blank"
              rel="noreferrer"
              className="font-bold text-brand"
            >
              {labels.privacyLink}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

import { buttonClasses, Card } from '@rede-social/ui';
import { ExternalLink, Lock } from 'lucide-react';
import { safeCheckoutUrl } from '@/lib/subscription';

/**
 * The no-access notice (09.1-15, UI-D-522, D-493, D-302; PAY-10): ONE sentence, "Seu acesso ainda não
 * foi liberado. Use o mesmo e-mail da compra.", in the `UnavailableCard` geometry (a centred `Card`,
 * `role="alert"`, a `Lock` glyph, no title), with an outline pay link ONLY when the community
 * registered a checkout link. It replaces the red alert line on sign-up and login and the form on
 * `/participar`: "you have not paid" is not an input error, so it is never red.
 *
 * **The same sentence answers every refusal** (never bought, subscription late, manual block, access in
 * another community), so it reveals nothing about any e-mail or any other community (D-302). The words
 * are the caller's (catalog) strings; this component holds none.
 *
 * **The link has one reader (UI-D-532, T-09.1-70).** `checkoutUrl` comes from the public tenant record
 * or the join state (both API answers, per request), never from the URL, and is rendered only when
 * `safeCheckoutUrl` accepts it: `https:` with a host and no credentials. The anchor opens a new tab with
 * `rel="noopener noreferrer"` and a visually hidden suffix that says so. Outline, not brand, keeps the
 * form's own submit the only brand fill on the screen.
 *
 * Overflow and long text (E09): the sentence is a fixed catalog string that wraps in the centred card,
 * and the pay link is a fixed catalog word in an `md` button, so nothing is container-bound at 320px.
 */
export function AccessNotice({
  message,
  subscribeLabel,
  newTabLabel,
  checkoutUrl,
}: {
  message: string;
  subscribeLabel: string;
  newTabLabel: string;
  checkoutUrl: string | null;
}) {
  const href = safeCheckoutUrl(checkoutUrl);
  return (
    <Card role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
      <Lock aria-hidden size={28} className="text-text-secondary" />
      <p className="break-words text-sm text-text">{message}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses({ variant: 'outline', size: 'md' })}
        >
          <ExternalLink aria-hidden size={18} />
          {subscribeLabel}
          <span className="sr-only"> {newTabLabel}</span>
        </a>
      ) : null}
    </Card>
  );
}

import { ExternalLink, Star } from 'lucide-react';
import type { AnswerView } from '@/lib/profile-form/answer-view';

/**
 * How one answer reads on a profile surface (12-14, UI-D-591; T-12-32). It renders the view the single
 * mapper (`answerView`) returned, as React TEXT only: there is no raw-HTML path, an e-mail is plain text
 * and a link exists only when the mapper decided the address is `http:` or `https:`.
 *
 * Text keeps its line breaks (`whitespace-pre-line`) and wraps anywhere, so a 1000-character answer or a
 * long address never widens the card at 320px. The anchor opens a new tab with `noopener noreferrer
 * nofollow ugc` (an answer is user-generated content). The rating shows its words and five small stars
 * (`aria-hidden`: the words carry the meaning), filled up to the rating.
 *
 * Synchronous and props only, so a Server Component renders it and so does a client test.
 */
export function AnswerValue({ view }: { view: AnswerView }) {
  switch (view.kind) {
    case 'text':
      return <span className="whitespace-pre-line break-words wrap-anywhere">{view.text}</span>;
    case 'link':
      return (
        <a
          href={view.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="break-words text-brand underline wrap-anywhere"
        >
          {view.text}
          <ExternalLink aria-hidden size={14} className="ml-1 inline align-[-2px]" />
        </a>
      );
    case 'rating':
      return (
        <span>
          {view.text}
          <span aria-hidden data-rating-stars className="ml-2 inline-flex align-middle text-brand">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                aria-hidden
                size={12}
                fill={n <= view.n ? 'currentColor' : 'none'}
                data-filled={n <= view.n || undefined}
              />
            ))}
          </span>
        </span>
      );
  }
}

'use client';

import { Button } from '@rede-social/ui';
import { type FormEvent, useRef, useState } from 'react';
import { CONFIRM_POST_PATH } from '@/lib/auth-confirm';

/**
 * The interstitial's form (quick 261117-kkx): a NATIVE post to `/auth/confirm` with the token in
 * hidden fields, so the POST URL carries no token and the form works with JavaScript off. The
 * labels arrive already translated by the server page.
 *
 * Double-tap guard: the first submit is not prevented (the native POST must go ahead) and only
 * flips the pending state; a second submit is prevented. A ref, not the state, decides, because two
 * quick events can fire before React re-renders.
 */
export function ConfirmForm({
  tokenHash,
  type,
  next,
  label,
  pendingLabel,
}: {
  tokenHash: string;
  type: string;
  next: string;
  label: string;
  pendingLabel: string;
}) {
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitted.current) {
      event.preventDefault();
      return;
    }
    submitted.current = true;
    setPending(true);
  }

  return (
    <form
      method="post"
      action={CONFIRM_POST_PATH}
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      <Button type="submit" variant="brand" size="lg" fullWidth loading={pending}>
        {pending ? pendingLabel : label}
      </Button>
    </form>
  );
}

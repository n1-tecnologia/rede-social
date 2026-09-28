'use client';

import { type PostShareTarget, sharePost } from '@rede-social/module-feed/ui';
import { useToast } from '@rede-social/ui';
import { useCallback } from 'react';

/**
 * THE composition point for FEED-07's share (UI-SPEC E16): it binds the browser's real surfaces to
 * `sharePost` and owns the four-result branch table. The module component raises the event; nothing
 * inside `@rede-social/module-feed` decides what a share outcome MEANS, and nothing inside it holds a
 * catalog string (PWA-03).
 *
 * | Result        | What happens here          | Why |
 * |---------------|----------------------------|-----|
 * | `'shared'`    | nothing                    | the OS sheet already told the member it worked |
 * | `'dismissed'` | **nothing**                | the member closed the sheet; that is not a failure (T-04-53) |
 * | `'copied'`    | the "Link copiado." toast  | the desktop path needs its own confirmation |
 * | `'failed'`    | the generic error toast    | the same rule a failed like follows |
 *
 * **The url is never derived here.** It arrives on the event, composed on the SERVER from the
 * tenant's verified primary host (`primaryHostOrigin`), which is what keeps an alias host out of a
 * link a member sends to another member. `title` is the tenant's own display name from the
 * bootstrap — the share sheet names the community, never a caption (T-04-52).
 *
 * The surfaces are read at CALL time, not at render: `navigator.share` is absent on desktop and
 * `navigator.clipboard` is absent in an insecure context, and either can disappear between a render
 * and a tap. Reading them inside the handler also keeps this hook safe to call during SSR.
 */
export function useSharePost(title: string, labels: { copied: string; error: string }) {
  const toast = useToast();

  return useCallback(
    (target: PostShareTarget) => {
      const nav = typeof navigator === 'undefined' ? undefined : navigator;
      void sharePost(
        { url: target.url, title },
        {
          share: nav?.share ? (data) => nav.share(data) : undefined,
          clipboard: nav?.clipboard ? (text) => nav.clipboard.writeText(text) : undefined,
        },
      ).then((result) => {
        if (result === 'copied') toast.show({ tone: 'success', message: labels.copied });
        if (result === 'failed') toast.show({ tone: 'error', message: labels.error });
        // 'shared' and 'dismissed' raise nothing, on purpose.
      });
    },
    [title, toast, labels.copied, labels.error],
  );
}

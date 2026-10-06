'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The cover an admin just chose, shown AT ONCE in the form's preview (2026-10-06).
 *
 * Why it exists: `complete` answers an image still `processing`, with an EMPTY variant ladder; the
 * worker derives the ladder a moment later. The community and event forms rendered the cover from
 * that answer, so the preview showed a blank box under the veil until the page was reloaded. The
 * fix is the picture the admin picked: `useSignedUpload` hands the very file it uploads to
 * `onPicked`, this hook keeps it as an object URL, and once the upload completes it is tied to the
 * new asset id. The preview shows it while that asset is the form's cover; any other cover (the
 * saved one, or none) renders as before.
 *
 * Object URLs live in this browser only and are revoked when replaced and on unmount.
 */
export function useCoverPreview(coverAssetId: string | null) {
  /** The file being uploaded, not yet tied to an asset. */
  const picked = useRef<string | null>(null);
  const [shown, setShown] = useState<{ assetId: string; url: string } | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const onPicked = useCallback((file: File) => {
    if (picked.current) URL.revokeObjectURL(picked.current);
    picked.current = URL.createObjectURL(file);
  }, []);

  /** The upload of the picked file completed as `assetId`. */
  const onUploaded = useCallback((assetId: string) => {
    const url = picked.current;
    picked.current = null;
    if (!url) return;
    const previous = shownRef.current;
    if (previous) URL.revokeObjectURL(previous.url);
    setShown({ assetId, url });
  }, []);

  useEffect(
    () => () => {
      if (picked.current) URL.revokeObjectURL(picked.current);
      if (shownRef.current) URL.revokeObjectURL(shownRef.current.url);
    },
    [],
  );

  return {
    previewUrl: shown !== null && shown.assetId === coverAssetId ? shown.url : null,
    onPicked,
    onUploaded,
  };
}

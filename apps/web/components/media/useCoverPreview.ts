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
 * Object URLs live in this browser only. Each is created by the effect that shows it and revoked by
 * that effect's cleanup (replaced, or unmounted).
 */
export function useCoverPreview(coverAssetId: string | null) {
  /** The file being uploaded, not yet tied to an asset. */
  const picked = useRef<File | null>(null);
  const [shown, setShown] = useState<{ assetId: string; file: File } | null>(null);
  const [url, setUrl] = useState<{ file: File; url: string } | null>(null);

  // 08.2-12: the object URL is owned by THIS effect, keyed on the file it shows. The earlier hook
  // created it at pick time and revoked it in a mount-only cleanup, so any cleanup that React runs
  // while the form stays on screen (a Strict Mode re-run, an `<Activity>` hide and show) revoked the
  // URL the preview still pointed at, and the image failed with ERR_FILE_NOT_FOUND (seen once in the
  // E11 backstop). Now every cleanup revokes exactly the URL its run created, and the next run makes
  // a fresh one.
  useEffect(() => {
    if (!shown) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(shown.file);
    setUrl({ file: shown.file, url: next });
    return () => URL.revokeObjectURL(next);
  }, [shown]);

  const onPicked = useCallback((file: File) => {
    picked.current = file;
  }, []);

  /** The upload of the picked file completed as `assetId`. */
  const onUploaded = useCallback((assetId: string) => {
    const file = picked.current;
    picked.current = null;
    if (!file) return;
    setShown({ assetId, file });
  }, []);

  const current = shown !== null && url !== null && url.file === shown.file ? url.url : null;
  return {
    previewUrl: shown !== null && shown.assetId === coverAssetId ? current : null,
    onPicked,
    onUploaded,
  };
}

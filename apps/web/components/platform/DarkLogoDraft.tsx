'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * The Marca tab's dark-mode logo (2026-10-05, the wizard's second logo on a tenant that already
 * exists). PREVIEW ONLY, as in the wizard: the API has no field for it, so it is never uploaded. The
 * picked file lives in this browser as an object URL and paints the colours card's dark frame.
 *
 * It sits ABOVE the colours form and the look provider in the page: both remount on a save or an
 * upload (`brandingViewKey`, `brandLookKey`), and the picked logo must not vanish with them.
 */
export type DarkLogoDraft = {
  image: { url: string } | null;
  /** A file replaces the current one; `null` removes it. */
  pick: (file: File | null) => void;
};

const DarkLogoContext = createContext<DarkLogoDraft | null>(null);

export function DarkLogoProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<{ url: string } | null>(null);
  const current = useRef<string | null>(null);

  const pick = useCallback((file: File | null) => {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = file ? URL.createObjectURL(file) : null;
    setImage(current.current ? { url: current.current } : null);
  }, []);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = null;
    },
    [],
  );

  const value = useMemo<DarkLogoDraft>(() => ({ image, pick }), [image, pick]);
  return <DarkLogoContext.Provider value={value}>{children}</DarkLogoContext.Provider>;
}

/** `null` outside the Marca tab: the form then shows no dark zone and its frames use the one logo. */
export function useOptionalDarkLogo(): DarkLogoDraft | null {
  return useContext(DarkLogoContext);
}

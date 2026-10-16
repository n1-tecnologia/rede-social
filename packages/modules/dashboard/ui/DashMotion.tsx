'use client';

import { useEffect } from 'react';

/** The surfaces that rise into view (`RISE` in surface.ts). */
const SELECTOR = '.dash-reveal';

/**
 * The panels' entrance, mounted once by the host page: every surface marked `.dash-reveal` waits
 * hidden (tokens.css) and rises in when it scrolls into view, the first ones at once; its charts,
 * bars and counters start then too. It watches the page for surfaces added later (a list opened, a
 * collapsible opened, a client navigation). It marks the root (`data-dash-js`) so the no-script
 * fallback in tokens.css stands down. Under reduced motion everything is shown at once.
 */
export function DashMotion() {
  useEffect(() => {
    document.documentElement.setAttribute('data-dash-js', '');
    const reveal = (el: Element) => el.setAttribute('data-revealed', '');
    const still =
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (still) {
      const showAll = () => {
        for (const el of document.querySelectorAll(`${SELECTOR}:not([data-revealed])`)) {
          reveal(el);
        }
      };
      showAll();
      const mutations = new MutationObserver(showAll);
      mutations.observe(document.body, { childList: true, subtree: true });
      return () => mutations.disconnect();
    }

    const watched = new WeakSet<Element>();
    const visible = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          visible.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );
    const watch = () => {
      for (const el of document.querySelectorAll(`${SELECTOR}:not([data-revealed])`)) {
        if (watched.has(el)) continue;
        watched.add(el);
        visible.observe(el);
      }
    };
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      visible.disconnect();
      mutations.disconnect();
    };
  }, []);

  return null;
}

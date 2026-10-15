'use client';

import { useEffect, useRef, useState } from 'react';

/** How long a count takes, and its ease (fast, then settling on the value). */
const DURATION = 1000;
const ease = (t: number) => 1 - (1 - t) ** 3;

/** A pt-BR number inside a formatted value: `8.430`, `14,4`, `8.940,00`, `04`, `22`. */
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;

interface NumberPart {
  value: number;
  decimals: number;
  grouped: boolean;
  /** The digits a zero-padded integer keeps ("04" in "1h04"). */
  width: number;
}

type Part = string | NumberPart;

/** The minutes of a duration ("40" in "1h40"): after an "h" that follows a digit. They run, in two digits. */
function isMinutes(text: string, index: number): boolean {
  return text[index - 1] === 'h' && /\d/.test(text[index - 2] ?? '');
}

/**
 * Whether the number at `index` names a moment or a label, not an amount, so it must not run: a
 * date or a clock ("17/10", "0:41"), an hour of the day ("20h", "20h–22h", but not "1h40", a
 * duration), or a number glued to a word ("S12").
 */
function isFixed(text: string, index: number, length: number): boolean {
  const before = text[index - 1] ?? '';
  const after = text[index + length] ?? '';
  const afterNext = text[index + length + 1] ?? '';
  const minutes = isMinutes(text, index);
  return (
    before === '/' ||
    before === ':' ||
    after === '/' ||
    after === ':' ||
    (/\p{L}/u.test(before) && !minutes) ||
    (after === 'h' && !/\d/.test(afterNext))
  );
}

/**
 * The value cut into its text and its numbers, so the text stays put while the numbers run. A date,
 * an hour of the day or a numbered label stays text (`isFixed`).
 */
export function countUpParts(text: string): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const match of text.matchAll(NUMBER)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (isFixed(text, index, token.length)) continue;
    if (index > at) parts.push(text.slice(at, index));
    const [int = '', dec = ''] = token.split(',');
    const digits = int.replace(/\./g, '');
    parts.push({
      value: Number(`${digits}.${dec || '0'}`),
      decimals: dec.length,
      grouped: int.includes('.'),
      width: isMinutes(text, index)
        ? 2
        : digits.startsWith('0') && digits.length > 1
          ? digits.length
          : 0,
    });
    at = index + token.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/** One number at `value`, written the way the original was (grouping, decimals, padding). */
function formatNumber(value: number, part: NumberPart): string {
  const [int = '0', dec] = value.toFixed(part.decimals).split('.');
  let whole = part.grouped ? int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : int;
  if (part.width > whole.length) whole = whole.padStart(part.width, '0');
  return dec ? `${whole},${dec}` : whole;
}

/** The whole value with every number at `progress` (0–1) of its way from zero. */
export function countUpText(parts: readonly Part[], progress: number): string {
  return parts
    .map((part) =>
      typeof part === 'string'
        ? part
        : formatNumber(progress >= 1 ? part.value : part.value * progress, part),
    )
    .join('');
}

export interface CountUpProps {
  /** The final value, already formatted by the host ("R$ 14,4 mil", "8.430", "1 h 12 min"). */
  value: string;
}

/**
 * A formatted value whose numbers count up from zero when it scrolls into view, after the delay
 * its stagger parent hands it (`--dash-delay`). The words around the numbers never move, and the
 * last frame is the host's own text. Under reduced motion, or with nothing to count, the value is
 * simply shown.
 *
 * The value is rendered final and marked `pending` (tokens.css keeps it hidden; it shows as is
 * without script) until it scrolls into view, so the page never flashes the value, then zero, and
 * its text is the final one for anything that reads it before it counts.
 */
export function CountUp({ value }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  const [state, setState] = useState<'pending' | 'running' | 'done'>('pending');

  useEffect(() => {
    const el = ref.current;
    const parts = countUpParts(value);
    const hasNumbers = parts.some((part) => typeof part !== 'string');
    const still =
      !el ||
      !hasNumbers ||
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      setShown(value);
      setState('done');
      return;
    }
    // Until it scrolls into view the value stays pending: hidden, its final text in the page.
    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setShown(countUpText(parts, 0));
        setState('running');
        const delay = Number.parseFloat(getComputedStyle(el).getPropertyValue('--dash-delay')) || 0;
        const begin = performance.now() + delay + 120;
        const tick = (now: number) => {
          const t = Math.min(1, Math.max(0, (now - begin) / DURATION));
          if (t < 1) {
            setShown(countUpText(parts, ease(t)));
            frame = requestAnimationFrame(tick);
          } else {
            setShown(value);
            setState('done');
          }
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <span ref={ref} data-countup={state}>
      {shown}
    </span>
  );
}

'use client';

import { AlertCircle, CheckCircle, Info } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { cn } from '../cn';
import { takeFlashToast } from './flash-toast';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  tone: ToastTone;
  message: string;
  /** Auto-dismiss delay in ms (default 3000). */
  durationMs?: number;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneConfig = {
  success: { icon: CheckCircle, className: 'bg-success text-white' },
  error: { icon: AlertCircle, className: 'bg-danger text-white' },
  info: { icon: Info, className: 'bg-brand text-on-brand' },
} as const;

const TOAST_SPRING = { type: 'spring', damping: 22, stiffness: 300 } as const;
const DEFAULT_DURATION_MS = 3000;

export interface ToastProps {
  tone: ToastTone;
  message: string;
  className?: string;
}

/** The toast surface itself (one visible at a time; the provider owns the queue policy). */
export function Toast({ tone, message, className }: ToastProps) {
  const { icon: Icon, className: toneClass } = toneConfig[tone];
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={reduceMotion ? { opacity: 0 } : { y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { y: -80, opacity: 0 }}
      transition={reduceMotion ? { duration: 0 } : TOAST_SPRING}
      className={cn(
        'fixed left-4 right-4 z-[100] flex items-start gap-3 rounded-2xl px-4 py-3 shadow-lg',
        'md:left-auto md:right-6 md:max-w-[420px]',
        toneClass,
        className,
      )}
      style={{ top: 'var(--safe-top)' }}
    >
      <Icon aria-hidden size={20} className="mt-0.5 shrink-0" />
      <p className="flex-1 break-words text-sm font-normal leading-relaxed">{message}</p>
    </motion.div>
  );
}

interface ActiveToast extends ToastOptions {
  id: number;
}

/**
 * Hosts the single visible toast; a newer `show` replaces the current one. On mount it shows the
 * toast a save kept for this screen when it stepped back here from another document
 * (`flash-toast.ts`, 2026-10-09).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);

  const show = useCallback((options: ToastOptions) => {
    setToast({ ...options, id: Date.now() + Math.random() });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    const flash = takeFlashToast(window.location.pathname);
    if (flash) show(flash);
  }, [show]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      toast.durationMs ?? DEFAULT_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {toast ? <Toast key="toast" tone={toast.tone} message={toast.message} /> : null}
      </AnimatePresence>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}

import { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * A brief, in-app confirmation — never a push notification, never a system
 * banner. "Assistant" gets the assistant tint everywhere else in the app gets
 * it: a payment Entole made on your behalf reads differently from one you
 * made yourself, even in passing.
 */
export type ToastTone = 'settled' | 'assistant';

export type ToastEntry = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  toast: ToastEntry | null;
  show: (message: string, tone?: ToastTone) => void;
  dismiss: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS = 3200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastEntry | null>(null);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((message: string, tone: ToastTone = 'settled') => {
    if (timer.current) clearTimeout(timer.current);
    const id = (nextId.current += 1);
    setToast({ id, message, tone });
    timer.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, VISIBLE_MS);
  }, []);

  return <ToastContext.Provider value={{ toast, show, dismiss }}>{children}</ToastContext.Provider>;
}

export function useToast(): Pick<ToastContextValue, 'show' | 'dismiss'> {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}

/** The host reads this directly so only one place ever renders the banner. */
export function useToastEntry(): ToastEntry | null {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToastEntry must be used inside ToastProvider');
  return value.toast;
}

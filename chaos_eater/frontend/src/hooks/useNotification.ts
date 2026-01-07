import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Notification type
 */
export type NotificationType = 'success' | 'error' | 'info' | 'warning';

/**
 * Notification object
 */
export interface Notification {
  type: NotificationType;
  message: string;
}

/**
 * Options for useNotification hook
 */
export interface UseNotificationOptions {
  /** Auto-dismiss timeout in ms (default: 10000) */
  timeout?: number;
  /** Fade-out duration in ms (default: 500) */
  fadeOutDuration?: number;
}

/**
 * Return type for useNotification hook
 */
export interface UseNotificationReturn {
  notification: Notification | null;
  visible: boolean;
  notify: (type: NotificationType, message: string) => void;
  setNotification: (notification: Notification | null) => void;
  dismiss: () => void;
}

/**
 * Hook for managing notification state with auto-dismiss
 */
export function useNotification(options: UseNotificationOptions = {}): UseNotificationReturn {
  const { timeout = 10000, fadeOutDuration = 500 } = options;

  const [notification, setNotification] = useState<Notification | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((type: NotificationType, message: string) => {
    setNotification({ type, message });
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => setNotification(null), fadeOutDuration);
  }, [fadeOutDuration]);

  useEffect(() => {
    if (notification) {
      setVisible(true);

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }

      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        setTimeout(() => setNotification(null), fadeOutDuration);
      }, timeout);
    }

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [notification, timeout, fadeOutDuration]);

  return { notification, visible, notify, setNotification, dismiss };
}

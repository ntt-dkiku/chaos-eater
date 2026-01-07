import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotification } from '../../hooks/useNotification';

describe('useNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with null notification', () => {
    const { result } = renderHook(() => useNotification());
    expect(result.current.notification).toBeNull();
    expect(result.current.visible).toBe(false);
  });

  it('should set notification and visibility on notify', () => {
    const { result } = renderHook(() => useNotification());

    act(() => {
      result.current.notify('success', 'Test message');
    });

    expect(result.current.notification).toEqual({ type: 'success', message: 'Test message' });
    expect(result.current.visible).toBe(true);
  });

  it('should auto-dismiss after timeout', () => {
    const { result } = renderHook(() => useNotification({ timeout: 1000, fadeOutDuration: 100 }));

    act(() => {
      result.current.notify('info', 'Test');
    });

    expect(result.current.visible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.visible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.notification).toBeNull();
  });

  it('should dismiss immediately on dismiss()', () => {
    const { result } = renderHook(() => useNotification({ fadeOutDuration: 100 }));

    act(() => {
      result.current.notify('error', 'Error message');
    });

    expect(result.current.visible).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.visible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.notification).toBeNull();
  });

  it('should reset timer on new notification', () => {
    const { result } = renderHook(() => useNotification({ timeout: 1000, fadeOutDuration: 100 }));

    act(() => {
      result.current.notify('info', 'First');
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Still visible
    expect(result.current.visible).toBe(true);

    // New notification resets timer
    act(() => {
      result.current.notify('success', 'Second');
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Still visible because timer was reset
    expect(result.current.visible).toBe(true);
    expect(result.current.notification?.message).toBe('Second');

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Now it should hide
    expect(result.current.visible).toBe(false);
  });

  it('should allow setting notification directly', () => {
    const { result } = renderHook(() => useNotification());

    act(() => {
      result.current.setNotification({ type: 'warning', message: 'Direct set' });
    });

    expect(result.current.notification).toEqual({ type: 'warning', message: 'Direct set' });
    expect(result.current.visible).toBe(true);
  });

  it('should use default timeout of 10000ms', () => {
    const { result } = renderHook(() => useNotification());

    act(() => {
      result.current.notify('info', 'Test');
    });

    act(() => {
      vi.advanceTimersByTime(9999);
    });

    expect(result.current.visible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.visible).toBe(false);
  });
});

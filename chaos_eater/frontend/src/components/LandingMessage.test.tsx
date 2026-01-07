import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import LandingMessage from './LandingMessage';

describe('LandingMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render empty initially', () => {
    render(<LandingMessage />);
    const heading = screen.getByRole('heading');
    expect(heading.textContent).toBe('');
  });

  it('should have correct aria-label', () => {
    render(<LandingMessage />);
    const heading = screen.getByRole('heading');
    expect(heading).toHaveAttribute('aria-label', "Let's dive into Chaos together :)");
  });

  it('should type out text character by character', () => {
    render(<LandingMessage />);
    const heading = screen.getByRole('heading');

    // Initially empty
    expect(heading.textContent).toBe('');

    // Type first character
    act(() => {
      vi.advanceTimersByTime(70);
    });
    expect(heading.textContent).toBe('L');

    // Type 5 more characters one at a time (need separate act() for each to allow React re-renders)
    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(70);
      });
    }
    expect(heading.textContent).toBe("Let's ");
  });

  it('should highlight "Chaos" word', () => {
    render(<LandingMessage />);

    // Advance time to type past "Chaos" - need separate act() for each character
    const textLength = "Let's dive into Chaos".length;
    for (let i = 0; i < textLength; i++) {
      act(() => {
        vi.advanceTimersByTime(70);
      });
    }

    // Check for highlighted span
    const highlight = screen.getByText('Chaos');
    expect(highlight).toHaveStyle({ color: 'rgb(132, 204, 22)' }); // #84cc16
    expect(highlight).toHaveStyle({ fontWeight: '600' });
  });

  it('should complete the full message', () => {
    render(<LandingMessage />);

    const fullText = "Let's dive into Chaos together :)";
    // Type each character with separate act() to allow React re-renders
    for (let i = 0; i < fullText.length; i++) {
      act(() => {
        vi.advanceTimersByTime(70);
      });
    }

    const heading = screen.getByRole('heading');
    expect(heading.textContent).toBe(fullText);
  });

  it('should stop typing after full text is displayed', () => {
    render(<LandingMessage />);

    const fullText = "Let's dive into Chaos together :)";

    // Type full message
    for (let i = 0; i < fullText.length; i++) {
      act(() => {
        vi.advanceTimersByTime(70);
      });
    }

    // Wait more time
    for (let i = 0; i < 10; i++) {
      act(() => {
        vi.advanceTimersByTime(70);
      });
    }

    // Should still be the same
    const heading = screen.getByRole('heading');
    expect(heading.textContent).toBe(fullText);
  });

  it('should have correct styles', () => {
    render(<LandingMessage />);
    const heading = screen.getByRole('heading');

    expect(heading).toHaveStyle({
      fontSize: '30px',
      fontWeight: '600',
      userSelect: 'none',
    });
  });
});

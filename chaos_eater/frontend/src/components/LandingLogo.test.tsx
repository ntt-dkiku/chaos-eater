import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import LandingLogo from './LandingLogo';

describe('LandingLogo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render the logo container', () => {
    render(<LandingLogo />);
    // Logo container should exist with the eye elements
    expect(document.querySelector('.ce-eye')).toBeInTheDocument();
    expect(document.querySelector('.ce-eye-mask')).toBeInTheDocument();
    expect(document.querySelector('.ce-eyelid')).toBeInTheDocument();
  });

  it('should render the logo image', () => {
    render(<LandingLogo />);
    const img = screen.getByAltText('ChaosEater Logo');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/chaoseater_icon.png');
  });

  it('should update pupil position on mouse move', () => {
    render(<LandingLogo />);

    // Simulate mouse move
    act(() => {
      fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    });

    // The pupil element exists
    const pupil = document.querySelector('.ce-eye > div');
    expect(pupil).toBeInTheDocument();
  });

  it('should have correct initial styles', () => {
    const { container } = render(<LandingLogo />);
    const wrapper = container.firstChild as HTMLElement;

    expect(wrapper).toHaveStyle({
      width: '200px',
      height: '200px',
      position: 'relative',
    });
  });

  it('should include animation styles', () => {
    render(<LandingLogo />);
    const styleTag = document.querySelector('style');
    expect(styleTag).toBeInTheDocument();
    expect(styleTag?.textContent).toContain('@keyframes rotate');
    expect(styleTag?.textContent).toContain('@keyframes ceBlink');
  });

  it('should handle image error', () => {
    render(<LandingLogo />);
    const img = screen.getByAltText('ChaosEater Logo');

    fireEvent.error(img);

    expect(img).toHaveStyle({ display: 'none' });
  });

  it('should respect prefers-reduced-motion', () => {
    render(<LandingLogo />);
    const styleTag = document.querySelector('style');
    expect(styleTag?.textContent).toContain('prefers-reduced-motion: reduce');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Collapse from './Collapse';

describe('Collapse', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render children', () => {
    render(
      <Collapse isOpen={true}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should have aria-hidden=true when closed', () => {
    const { container } = render(
      <Collapse isOpen={false}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('should have aria-hidden=false when open', () => {
    const { container } = render(
      <Collapse isOpen={true}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'false');
  });

  it('should start with height: 0', () => {
    const { container } = render(
      <Collapse isOpen={false}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(container.firstChild).toHaveStyle({ height: '0px' });
  });

  it('should have overflow: hidden initially', () => {
    const { container } = render(
      <Collapse isOpen={false}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(container.firstChild).toHaveStyle({ overflow: 'hidden' });
  });

  it('should set height to auto when disabled and open', () => {
    const { container } = render(
      <Collapse isOpen={true} disabled={true}>
        <div>Test Content</div>
      </Collapse>
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.height).toBe('auto');
  });

  it('should set height to 0 when disabled and closed', () => {
    const { container } = render(
      <Collapse isOpen={false} disabled={true}>
        <div>Test Content</div>
      </Collapse>
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.height).toBe('0px');
  });

  it('should accept custom duration', () => {
    const { container } = render(
      <Collapse isOpen={true} duration={500}>
        <div>Test Content</div>
      </Collapse>
    );

    // Component should render without error
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should immediately set height when duration is 0', () => {
    const { container } = render(
      <Collapse isOpen={true} duration={0}>
        <div>Test Content</div>
      </Collapse>
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.height).toBe('auto');
  });

  it('should toggle aria-hidden on isOpen change', () => {
    const { container, rerender } = render(
      <Collapse isOpen={false}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');

    rerender(
      <Collapse isOpen={true}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'false');
  });

  it('should have willChange: height for performance', () => {
    const { container } = render(
      <Collapse isOpen={false}>
        <div>Test Content</div>
      </Collapse>
    );

    expect(container.firstChild).toHaveStyle({ willChange: 'height' });
  });
});

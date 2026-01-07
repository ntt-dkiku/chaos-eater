import React, { useEffect, useRef } from 'react';

export interface CollapseProps {
  isOpen: boolean;
  duration?: number;
  children: React.ReactNode;
  disabled?: boolean;
}

export default function Collapse({
  isOpen,
  duration = 240,
  children,
  disabled = false,
}: CollapseProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const noAnim = disabled || reduced || duration <= 0;

    const reflow = (): number => el.getBoundingClientRect().height;

    el.style.transition = 'none';

    if (isOpen) {
      if (el.style.height === 'auto') {
        el.style.height = `${el.scrollHeight}px`;
      }
      const start = el.getBoundingClientRect().height;
      el.style.height = `${start}px`;
      el.style.overflow = 'hidden';
      reflow();

      const target = el.scrollHeight;

      if (noAnim) {
        el.style.height = 'auto';
        el.style.overflow = 'visible';
        return;
      }

      requestAnimationFrame(() => {
        el.style.transition = `height ${duration}ms ease`;
        el.style.height = `${target}px`;

        const onEnd = (): void => {
          el.style.transition = 'none';
          el.style.height = 'auto';
          el.style.overflow = 'visible';
          el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd);
      });
    } else {
      const from =
        el.style.height === 'auto' || !el.style.height
          ? el.scrollHeight
          : el.getBoundingClientRect().height;

      el.style.height = `${from}px`;
      el.style.overflow = 'hidden';
      reflow();

      if (noAnim) {
        el.style.height = '0px';
        return;
      }

      requestAnimationFrame(() => {
        el.style.transition = `height ${duration}ms ease`;
        el.style.height = '0px';

        const onEnd = (): void => {
          el.style.transition = 'none';
          el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd);
      });
    }
  }, [isOpen, duration, disabled, reduced]);

  return (
    <div
      ref={ref}
      style={{
        height: 0,
        overflow: 'hidden',
        willChange: 'height',
      }}
      aria-hidden={!isOpen}
    >
      {children}
    </div>
  );
}

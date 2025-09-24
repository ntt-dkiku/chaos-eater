// Smooth, resilient collapse with height measurement and RAF scheduling.
// - Always keep children mounted in the DOM.
// - Animate only the wrapper's height.
// - Works well with React StrictMode and dynamic content.
// - Respects prefers-reduced-motion.

import React, { useEffect, useRef } from "react";

export default function Collapse({
  isOpen,
  duration = 240,
  children,
  // Optional: allow disabling animation in code (e.g., during SSR)
  disabled = false,
}) {
  const ref = useRef(null);

  // Detect prefers-reduced-motion and optionally disable transitions
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const noAnim = disabled || reduced || duration <= 0;

    // Helper: force reflow to ensure the browser applies the pending style
    const reflow = () => el.getBoundingClientRect().height; // eslint-disable-line no-unused-expressions

    // Clear any previous transition to set starting values deterministically
    el.style.transition = "none";

    if (isOpen) {
      // OPEN: from current height (0 or px) -> target scrollHeight -> set to auto at end
      // Step 1: if we are at 'auto', lock the current pixel height first
      if (el.style.height === "auto") {
        el.style.height = `${el.scrollHeight}px`;
      }
      // Step 2: ensure starting height is whatever it is now
      const start = el.getBoundingClientRect().height;
      el.style.height = `${start}px`;
      el.style.overflow = "hidden";
      reflow();

      const target = el.scrollHeight;

      if (noAnim) {
        el.style.height = "auto";
        el.style.overflow = "visible";
        return;
      }

      // Step 3 (next frame): apply transition to target height
      requestAnimationFrame(() => {
        el.style.transition = `height ${duration}ms ease`;
        el.style.height = `${target}px`;

        const onEnd = () => {
          el.style.transition = "none";
          el.style.height = "auto"; // allow natural growth/shrink after expand
          el.style.overflow = "visible";
          el.removeEventListener("transitionend", onEnd);
        };
        el.addEventListener("transitionend", onEnd);
      });
    } else {
      // CLOSE: from current height (auto or px) -> 0
      // If current is 'auto', lock to pixel height first
      const from =
        el.style.height === "auto" || !el.style.height
          ? el.scrollHeight
          : el.getBoundingClientRect().height;

      el.style.height = `${from}px`;
      el.style.overflow = "hidden";
      reflow();

      if (noAnim) {
        el.style.height = "0px";
        // Keep overflow hidden when closed
        return;
      }

      requestAnimationFrame(() => {
        el.style.transition = `height ${duration}ms ease`;
        el.style.height = "0px";

        const onEnd = () => {
          el.style.transition = "none";
          // Keep overflow hidden to prevent tabbing into offscreen content
          el.removeEventListener("transitionend", onEnd);
        };
        el.addEventListener("transitionend", onEnd);
      });
    }
  }, [isOpen, duration, disabled, reduced]);

  // IMPORTANT:
  // Do NOT set height based on isOpen here; it conflicts with the effect.
  // Start closed at 0 so first open animates.
  return (
    <div
      ref={ref}
      style={{
        height: 0,
        overflow: "hidden",
        willChange: "height",
      }}
      aria-hidden={!isOpen}
    >
      {children}
    </div>
  );
}

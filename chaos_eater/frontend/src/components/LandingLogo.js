import React, { useRef, useEffect, useState } from 'react';

export default function LandingLogo() {
  const logoRef = useRef(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Track mouse movement to move pupil
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (logoRef.current) {
        const rect = logoRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        const distance = Math.min(8, Math.hypot(e.clientX - centerX, e.clientY - centerY) / 20);

        setMousePosition({
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
        });
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div
      ref={logoRef}
      style={{
        width: '200px',
        height: '200px',
        position: 'relative',
        marginBottom: '0px',
        marginTop: '150px',
        userSelect: 'none',
      }}
    >
      {/* Rotating ChaosEater base icon */}
      <img
        src="/chaoseater_icon.png"
        style={{
          position: 'absolute',
          width: '80%',
          height: '80%',
          top: '10%',
          left: '10%',
          objectFit: 'contain',
          animation: 'rotate 30s linear infinite',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.nextSibling.style.display = 'flex';
        }}
      />

      {/* White eyeball background */}
      <div
        className="ce-eye"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '40px',
          height: '40px',
          backgroundColor: '#ffffff',
          borderRadius: '50%',
          overflow: 'hidden',
          pointerEvents: 'none',
          WebkitUserDrag: 'none',
          userSelect: 'none',
          zIndex: 2,
        }}
      >
        {/* Black pupil that follows the mouse */}
        <div
          style={{
            position: 'absolute',
            width: '20px',
            height: '20px',
            backgroundColor: '#000000',
            borderRadius: '50%',
            top: '50%',
            left: '50%',
            transform: `translate(calc(-50% + ${mousePosition.x}px), calc(-50% + ${mousePosition.y}px))`,
            transition: 'transform 0.1s ease-out',
            zIndex: 2,
          }}
        >
          {/* White highlight dot */}
          <div
            style={{
              position: 'absolute',
              width: '6px',
              height: '6px',
              backgroundColor: '#ffffff',
              borderRadius: '50%',
              top: '3px',
              right: '3px',
            }}
          />
        </div>
      </div>

      {/* Eyelid mask to contain blinking animation */}
      <div
        className="ce-eye-mask"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          overflow: 'hidden',
          zIndex: 4,
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        {/* Animated eyelid */}
        <div className="ce-eyelid" />
      </div>

      {/* CSS animations */}
      <style>
        {`
          /* Icon rotation */
          @keyframes rotate {
            from { transform: rotate(0deg); }
            to   { transform: rotate(-360deg); }
          }

          /* Eyelid blinking: stays open, quickly closes, then reopens */
          @keyframes ceBlink {
            0%   { transform: translateY(-100%); }
            96%  { transform: translateY(-100%); }
            98%  { transform: translateY(0%); }
            100% { transform: translateY(-100%); }
          }

          .ce-eyelid {
            position: absolute;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 120%;
            background: #000;
            border-radius: 50% 50% 0 0;
            transform: translateY(-100%);
            z-index: 5;

            /* Blink once after 5s, then repeat every 10s */
            animation-name: ceBlink, ceBlink;
            animation-duration: 5s, 10s;
            animation-timing-function: linear, linear;
            animation-iteration-count: 1, infinite;
            animation-direction: normal, normal;
            animation-delay: 0s, 5s;
          }

          /* Accessibility: disable animation if user prefers reduced motion */
          @media (prefers-reduced-motion: reduce) {
            .ce-eyelid {
              animation: none;
              transform: translateY(-100%);
            }
          }
        `}
      </style>
    </div>
  );
}

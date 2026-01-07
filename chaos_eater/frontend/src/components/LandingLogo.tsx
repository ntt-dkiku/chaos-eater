import React, { useRef, useEffect, useState } from 'react';

interface MousePosition {
  x: number;
  y: number;
}

export default function LandingLogo(): React.ReactElement {
  const logoRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState<MousePosition>({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
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

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const target = e.currentTarget;
    target.style.display = 'none';
    const nextSibling = target.nextSibling as HTMLElement | null;
    if (nextSibling) {
      nextSibling.style.display = 'flex';
    }
  };

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
      <img
        src="/chaoseater_icon.png"
        alt="ChaosEater Logo"
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
        onError={handleImageError}
      />

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
          userSelect: 'none',
          zIndex: 2,
        }}
      >
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
        <div className="ce-eyelid" />
      </div>

      <style>
        {`
          @keyframes rotate {
            from { transform: rotate(0deg); }
            to   { transform: rotate(-360deg); }
          }

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
            animation-name: ceBlink, ceBlink;
            animation-duration: 5s, 10s;
            animation-timing-function: linear, linear;
            animation-iteration-count: 1, infinite;
            animation-direction: normal, normal;
            animation-delay: 0s, 5s;
          }

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

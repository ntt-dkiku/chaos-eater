import React, { useEffect, useState } from 'react';

const FULL_TEXT = "Let's dive into Chaos together :)";
const HIGHLIGHT = 'Chaos';
const TYPING_SPEED_MS = 70;

export default function LandingMessage(): React.ReactElement {
  const [text, setText] = useState('');
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    if (charIndex >= FULL_TEXT.length) return;
    const id = setTimeout(() => {
      setText((prev) => prev + FULL_TEXT[charIndex]);
      setCharIndex((i) => i + 1);
    }, TYPING_SPEED_MS);
    return () => clearTimeout(id);
  }, [charIndex]);

  const renderWithHighlight = (): React.ReactNode => {
    const idx = text.indexOf(HIGHLIGHT);
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const word = text.slice(idx, idx + HIGHLIGHT.length);
    const after = text.slice(idx + HIGHLIGHT.length);
    return (
      <>
        {before}
        <span style={{ color: '#84cc16', fontWeight: 600 }}>{word}</span>
        {after}
      </>
    );
  };

  return (
    <h1
      style={{
        fontSize: '30px',
        fontWeight: 600,
        margin: '0 0 48px',
        userSelect: 'none',
        whiteSpace: 'pre-wrap',
      }}
      aria-label={FULL_TEXT}
    >
      {renderWithHighlight()}
    </h1>
  );
}

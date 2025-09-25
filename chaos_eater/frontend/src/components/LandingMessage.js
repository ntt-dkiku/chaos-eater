import React, { useEffect, useState } from 'react';

export default function LandingMessage() {
  const fullText = "Let's dive into Chaos together :)";
  const highlight = 'Chaos';
  const [text, setText] = useState('');
  const [i, setI] = useState(0);

  useEffect(() => {
    if (i >= fullText.length) return;
    const id = setTimeout(() => {
      setText(prev => prev + fullText[i]);
      setI(i + 1);
    }, 70); // typing speed (ms per char)
    return () => clearTimeout(id);
  }, [i, fullText]);

  // Safely render with highlight only when the full word exists
  const renderWithHighlight = () => {
    const idx = text.indexOf(highlight);
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const word = text.slice(idx, idx + highlight.length);
    const after = text.slice(idx + highlight.length);
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
      aria-label={fullText}
    >
      {renderWithHighlight()}
    </h1>
  );
}

import React from 'react';
import { Plus, Minus } from 'lucide-react';

export interface NumberFieldProps {
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  min?: number;
  max?: number;
  step?: number;
}

export default function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
}: NumberFieldProps): React.ReactElement {
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));

  const increment = (): void => {
    const newVal = clamp((Number(value) || 0) + step);
    onChange(Number(newVal.toFixed(10)));
  };

  const decrement = (): void => {
    const newVal = clamp((Number(value) || 0) - step);
    onChange(Number(newVal.toFixed(10)));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value;
    if (raw === '') {
      onChange('');
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      onChange(min);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.color = '#84cc16';
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.color = '#9ca3af';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>{label}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#0a0a0a',
          border: '1px solid #1f2937',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        <input
          className="ce-number"
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={handleInputChange}
          style={{
            flex: 1,
            padding: '10px 12px',
            backgroundColor: 'transparent',
            border: 'none',
            color: '#e5e7eb',
            fontSize: '14px',
            outline: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0px 4px',
          }}
        >
          <button
            type="button"
            onClick={increment}
            aria-label="Increment"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '0px 8px',
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={decrement}
            aria-label="Decrement"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '0px 8px',
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <Minus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

import React from "react";
import { Plus, Minus } from "lucide-react";

export default function NumberField({
    label,
    value,
    onChange,
    min = 0,
    max = 99,
    step = 1
}) {
  const clamp = (n) => Math.min(max, Math.max(min, n));

  const increment = () => {
    const newVal = clamp((Number(value) || 0) + step);
    onChange(Number(newVal.toFixed(10)));
  };

  const decrement = () => {
    const newVal = clamp((Number(value) || 0) - step);
    onChange(Number(newVal.toFixed(10)));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#9ca3af" }}>{label}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          backgroundColor: "#0a0a0a",
          border: "1px solid #1f2937",
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        <input
          className="ce-number"
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange("");
              return;
            }
            const parsed = Number(raw);
            if (Number.isNaN(parsed)) {
              onChange(min);
              return;
            }
            const clamped = Math.min(max, Math.max(min, parsed));
            onChange(clamped);
          }}
          style={{
            flex: 1,
            padding: "10px 12px",
            backgroundColor: "transparent",
            border: "none",
            color: "#e5e7eb",
            fontSize: "14px",
            outline: "none",
          }}
        />
        
        <div style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: 'center',
            alignItems: 'center',
            padding: "0px 4px"
        }}>
          <button
            onClick={increment}
            style={{
              background: "transparent",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "0px 8px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#84cc16")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
          >
            <Plus size={14} />
          </button>
          <button
            onClick={decrement}
            style={{
              background: "transparent",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "0px 8px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#84cc16")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
          >
            <Minus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
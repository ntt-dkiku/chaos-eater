/**
 * Theme constants for ChaosEater UI
 * Centralized color palette, spacing, and other design tokens
 */

// Color palette
export const colors = {
  // Background colors
  bgPrimary: '#191919',      // Main background
  bgSecondary: '#111111',    // Sidebar background
  bgTertiary: '#1f1f1f',     // Card/panel background
  bgHover: '#2a2a2a',        // Hover state background
  bgInput: '#0a0a0a',        // Input field background
  bgSidebarHover: '#1a1a1a', // Sidebar item hover

  // Text colors
  textPrimary: '#e5e7eb',    // Main text
  textSecondary: '#9ca3af',  // Secondary text
  textMuted: '#6b7280',      // Muted/placeholder text
  textDark: '#a9a9a9',       // Dark mode secondary
  textLight: '#d1d5db',      // Light secondary

  // Accent colors
  accent: '#84cc16',         // Lime green (brand color)
  accentHover: '#a3e635',    // Lighter lime for hover

  // Border colors
  border: '#374151',         // Standard border
  borderLight: '#1f2937',    // Lighter border

  // Status colors
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',

  // Special colors
  black: '#000000',
  white: '#ffffff',
  transparent: 'transparent',
} as const;

// Spacing values
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
} as const;

// Border radius
export const borderRadius = {
  none: '0',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const;

// Font sizes
export const fontSize = {
  xs: '11px',
  sm: '12px',
  md: '13px',
  base: '14px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
} as const;

// Font weights
export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

// Transitions
export const transition = {
  fast: 'all 0.15s ease',
  normal: 'all 0.2s ease',
  slow: 'all 0.3s ease',
  colorOnly: 'background-color 0.2s ease, color 0.2s ease',
  opacity: 'opacity 0.3s ease',
} as const;

// Box shadows
export const boxShadow = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,0.2)',
  md: '0 4px 12px rgba(0,0,0,0.25)',
  lg: '0 10px 30px rgba(0,0,0,0.3)',
  accent: '0 10px 30px rgba(132, 204, 22, 0.2)',
} as const;

// Z-index layers
export const zIndex = {
  base: 0,
  dropdown: 100,
  modal: 200,
  toast: 300,
  tooltip: 400,
} as const;

// Type exports for use in components
export type Colors = typeof colors;
export type Spacing = typeof spacing;
export type BorderRadius = typeof borderRadius;
export type FontSize = typeof fontSize;
export type FontWeight = typeof fontWeight;
export type Transition = typeof transition;
export type BoxShadow = typeof boxShadow;
export type ZIndex = typeof zIndex;

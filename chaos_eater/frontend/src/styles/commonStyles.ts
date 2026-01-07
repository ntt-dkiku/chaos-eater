/**
 * Common style objects for ChaosEater UI components
 * Use these to maintain consistency and reduce inline styles
 */
import type { CSSProperties } from 'react';
import { colors, spacing, borderRadius, fontSize, fontWeight, transition, boxShadow, zIndex } from './theme';

// =============================================================================
// Button Styles
// =============================================================================

export const buttonStyles = {
  /**
   * Ghost button - transparent background, used in sidebar menus
   */
  ghost: {
    width: '100%',
    padding: `10px ${spacing.sm}`,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: colors.transparent,
    border: 'none',
    borderRadius: borderRadius.lg,
    color: colors.textPrimary,
    cursor: 'pointer',
    transition: transition.colorOnly,
  } as CSSProperties,

  /**
   * Primary button - accent colored for main actions
   */
  primary: {
    padding: `${spacing.md} ${spacing.lg}`,
    backgroundColor: colors.accent,
    border: 'none',
    borderRadius: borderRadius.md,
    color: colors.black,
    fontWeight: fontWeight.semibold,
    cursor: 'pointer',
    transition: transition.normal,
  } as CSSProperties,

  /**
   * Secondary button - outlined style
   */
  secondary: {
    padding: '10px 16px',
    backgroundColor: colors.bgTertiary,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.md,
    color: colors.textPrimary,
    fontSize: fontSize.md,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    transition: transition.normal,
  } as CSSProperties,

  /**
   * Icon button - square button for icons
   */
  icon: {
    width: '32px',
    height: '32px',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.transparent,
    border: 'none',
    color: colors.textLight,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: transition.normal,
    boxShadow: boxShadow.md,
  } as CSSProperties,

  /**
   * Small icon button - for compact spaces
   */
  iconSmall: {
    width: '24px',
    height: '24px',
    borderRadius: borderRadius.sm,
    backgroundColor: colors.transparent,
    border: 'none',
    color: colors.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: transition.normal,
  } as CSSProperties,

  /**
   * Medium icon button - 28x28 for delete/action icons
   */
  iconMedium: {
    width: '28px',
    height: '28px',
    borderRadius: borderRadius.md,
    backgroundColor: colors.transparent,
    border: 'none',
    color: colors.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: transition.normal,
  } as CSSProperties,

  /**
   * Danger button - for destructive actions
   */
  danger: {
    padding: `${spacing.sm} ${spacing.md}`,
    backgroundColor: colors.error,
    border: 'none',
    borderRadius: borderRadius.md,
    color: colors.white,
    cursor: 'pointer',
    transition: transition.normal,
  } as CSSProperties,

  /**
   * Disabled button state
   */
  disabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as CSSProperties,

  /**
   * Floating button - fixed position with shadow
   */
  floating: {
    position: 'fixed' as const,
    width: '32px',
    height: '32px',
    borderRadius: '10px',
    backgroundColor: colors.bgTertiary,
    border: `1px solid ${colors.border}`,
    color: colors.textLight,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: transition.normal,
    boxShadow: boxShadow.md,
  } as CSSProperties,
} as const;

// =============================================================================
// Input Styles
// =============================================================================

export const inputStyles = {
  /**
   * Base input field style
   */
  base: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: borderRadius.sm,
    color: colors.textPrimary,
    fontSize: fontSize.base,
    outline: 'none',
    transition: transition.fast,
    boxSizing: 'border-box' as const,
  } as CSSProperties,

  /**
   * Select dropdown style
   */
  select: {
    width: '100%',
    padding: `10px 36px 10px ${spacing.md}`,
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: borderRadius.sm,
    color: colors.textPrimary,
    fontSize: fontSize.base,
    cursor: 'pointer',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    outline: 'none',
    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    backgroundSize: '20px',
    transition: transition.fast,
  } as CSSProperties,

  /**
   * Textarea style
   */
  textarea: {
    width: '100%',
    padding: spacing.md,
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: borderRadius.sm,
    color: colors.textPrimary,
    fontSize: fontSize.base,
    resize: 'vertical' as const,
    outline: 'none',
    fontFamily: 'inherit',
  } as CSSProperties,

  /**
   * Input wrapper with icon
   */
  wrapper: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  } as CSSProperties,

  /**
   * Input label style
   */
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    color: colors.textDark,
    letterSpacing: '0.5px',
    display: 'block',
  } as CSSProperties,

  /**
   * Custom checkbox style
   */
  checkbox: {
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    width: '18px',
    height: '18px',
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: '3px',
    cursor: 'pointer',
    position: 'relative' as const,
    outline: 'none',
  } as CSSProperties,

  /**
   * Checkbox label container style
   */
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
    fontSize: fontSize.base,
    color: colors.textPrimary,
  } as CSSProperties,

  /**
   * Checkbox icon overlay style
   */
  checkboxIcon: {
    position: 'absolute' as const,
    top: '5px',
    left: '4px',
    color: colors.accent,
    pointerEvents: 'none' as const,
  } as CSSProperties,
} as const;

// =============================================================================
// Card Styles
// =============================================================================

export const cardStyles = {
  /**
   * Example card - clickable card with hover effect
   */
  example: {
    padding: spacing.xl,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    border: `1px solid ${colors.border}`,
    transition: transition.slow,
    cursor: 'pointer',
    textAlign: 'center' as const,
  } as CSSProperties,

  /**
   * Example card hover state
   */
  exampleHover: {
    backgroundColor: colors.bgHover,
    border: `1px solid ${colors.accent}`,
    transform: 'translateY(-4px)',
    boxShadow: boxShadow.accent,
  } as CSSProperties,

  /**
   * Example card title
   */
  exampleTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.sm,
    color: colors.white,
    transition: transition.slow,
  } as CSSProperties,

  /**
   * Example card title hover state
   */
  exampleTitleHover: {
    color: colors.accent,
  } as CSSProperties,

  /**
   * Example card description
   */
  exampleDesc: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    transition: transition.slow,
  } as CSSProperties,

  /**
   * Example card description hover state
   */
  exampleDescHover: {
    color: colors.textLight,
  } as CSSProperties,
} as const;

// =============================================================================
// Snapshot List Styles
// =============================================================================

export const snapshotStyles = {
  /**
   * Snapshot item button base
   */
  item: {
    width: '100%',
    textAlign: 'left' as const,
    padding: '3px 12px',
    backgroundColor: colors.transparent,
    border: 'none',
    borderRadius: borderRadius.lg,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    transition: transition.colorOnly,
    color: colors.textPrimary,
  } as CSSProperties,

  /**
   * Snapshot item selected state (current snapshot)
   */
  itemSelected: {
    backgroundColor: '#222222',
  } as CSSProperties,

  /**
   * Snapshot item hover state
   */
  itemHover: {
    backgroundColor: colors.bgSidebarHover,
    color: colors.accent,
  } as CSSProperties,

  /**
   * Snapshot item title text
   */
  itemTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginLeft: '-4px',
    marginRight: spacing.sm,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as CSSProperties,
} as const;

// =============================================================================
// Chip/Tag Styles
// =============================================================================

export const chipStyles = {
  /**
   * File chip - for uploaded files display
   */
  file: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '6px 12px',
    backgroundColor: colors.bgHover,
    borderRadius: borderRadius.full,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    border: `1px solid ${colors.border}`,
  } as CSSProperties,

  /**
   * Close button for chips
   */
  closeButton: {
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    cursor: 'pointer',
    padding: '2px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: borderRadius.full,
    transition: transition.normal,
  } as CSSProperties,
} as const;

// =============================================================================
// Composer/Input Area Styles
// =============================================================================

export const composerStyles = {
  /**
   * Main composer container
   */
  container: {
    position: 'relative' as const,
    borderRadius: borderRadius.lg,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgTertiary,
    transition: transition.normal,
    boxShadow: boxShadow.md,
  } as CSSProperties,

  /**
   * Files preview container
   */
  filesPreview: {
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bgSidebarHover,
    borderRadius: borderRadius.lg,
    border: `1px solid ${colors.border}`,
  } as CSSProperties,

  /**
   * Composer textarea
   */
  textarea: {
    width: '100%',
    padding: spacing.lg,
    backgroundColor: colors.transparent,
    borderRadius: '8px 8px 0 0',
    border: 'none',
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontFamily: 'inherit',
    resize: 'none' as const,
    outline: 'none',
    transition: transition.normal,
    lineHeight: '24px',
    boxSizing: 'border-box' as const,
    minHeight: '32px',
    overflow: 'hidden' as const,
  } as CSSProperties,

  /**
   * Lower controls section
   */
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    backgroundColor: colors.bgSidebarHover,
    borderRadius: '0 0 8px 8px',
  } as CSSProperties,

  /**
   * Control button group
   */
  controlGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  } as CSSProperties,
} as const;

// =============================================================================
// Menu/Dropdown Styles
// =============================================================================

export const menuStyles = {
  /**
   * Dropdown menu container
   */
  dropdown: {
    position: 'absolute' as const,
    minWidth: 160,
    backgroundColor: '#111827',
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.lg,
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    overflow: 'hidden',
    zIndex: zIndex.dropdown,
  } as CSSProperties,

  /**
   * Menu item button style
   */
  item: {
    width: '100%',
    padding: `${spacing.sm} 10px`,
    backgroundColor: colors.transparent,
    border: 'none',
    color: colors.textPrimary,
    textAlign: 'left' as const,
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    cursor: 'pointer',
    fontSize: fontSize.md,
  } as CSSProperties,

  /**
   * Danger menu item (delete, etc.)
   */
  itemDanger: {
    width: '100%',
    padding: `${spacing.sm} 10px`,
    backgroundColor: colors.transparent,
    border: 'none',
    color: colors.error,
    textAlign: 'left' as const,
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
    cursor: 'pointer',
    fontSize: fontSize.md,
  } as CSSProperties,
} as const;

// =============================================================================
// Layout Styles
// =============================================================================

export const layoutStyles = {
  /**
   * Flex container centered both axes
   */
  flexCenter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as CSSProperties,

  /**
   * Flex container with space between
   */
  flexBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as CSSProperties,

  /**
   * Flex column container
   */
  flexColumn: {
    display: 'flex',
    flexDirection: 'column' as const,
  } as CSSProperties,

  /**
   * Flex row with gap
   */
  flexRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  } as CSSProperties,

  /**
   * Full height container
   */
  fullHeight: {
    height: '100vh',
  } as CSSProperties,

  /**
   * Full width container
   */
  fullWidth: {
    width: '100%',
  } as CSSProperties,
} as const;

// =============================================================================
// Container Styles
// =============================================================================

export const containerStyles = {
  /**
   * Main app container
   */
  app: {
    display: 'flex',
    height: '100vh',
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    position: 'relative' as const,
  } as CSSProperties,

  /**
   * Sidebar container
   */
  sidebar: {
    backgroundColor: colors.bgSecondary,
    borderRight: `1px solid ${colors.border}`,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    transition: transition.slow,
    position: 'relative' as const,
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
  } as CSSProperties,

  /**
   * Card/panel container
   */
  card: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    border: `1px solid ${colors.border}`,
    padding: spacing.lg,
  } as CSSProperties,

  /**
   * Section with padding
   */
  section: {
    padding: `0 ${spacing.sm}`,
  } as CSSProperties,

  /**
   * Header section
   */
  header: {
    padding: spacing.lg,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  } as CSSProperties,
} as const;

// =============================================================================
// Text Styles
// =============================================================================

export const textStyles = {
  /**
   * Heading large
   */
  heading: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.extrabold,
    fontVariant: 'small-caps' as const,
  } as CSSProperties,

  /**
   * Section title
   */
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  } as CSSProperties,

  /**
   * Body text
   */
  body: {
    fontSize: fontSize.base,
    color: colors.textPrimary,
  } as CSSProperties,

  /**
   * Small/secondary text
   */
  small: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  } as CSSProperties,

  /**
   * Muted text
   */
  muted: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  } as CSSProperties,

  /**
   * Accent colored text
   */
  accent: {
    color: colors.accent,
  } as CSSProperties,
} as const;

// =============================================================================
// Notification Toast Styles
// =============================================================================

export const notificationStyles = {
  /**
   * Base notification toast
   */
  base: {
    border: 'none',
    borderRadius: borderRadius.md,
    padding: '6px 10px',
    fontSize: fontSize.md,
    transition: transition.opacity,
    whiteSpace: 'nowrap' as const,
    maxWidth: '360px',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis',
  } as CSSProperties,

  /**
   * Success notification
   */
  success: {
    backgroundColor: colors.accent,
    color: colors.black,
  } as CSSProperties,

  /**
   * Error notification
   */
  error: {
    backgroundColor: '#7f1d1d',
    color: colors.textPrimary,
  } as CSSProperties,

  /**
   * Warning notification
   */
  warning: {
    backgroundColor: colors.warning,
    color: colors.black,
  } as CSSProperties,
} as const;

// =============================================================================
// Action Button Styles (Send/Stop)
// =============================================================================

export const actionButtonStyles = {
  /**
   * Send button - accent colored circular button
   */
  send: {
    width: '32px',
    height: '32px',
    padding: 0,
    backgroundColor: colors.accent,
    border: 'none',
    borderRadius: borderRadius.md,
    color: colors.black,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: transition.normal,
    boxShadow: '0 2px 8px rgba(132, 204, 22, 0.3)',
  } as CSSProperties,

  /**
   * Send button disabled state
   */
  sendDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as CSSProperties,

  /**
   * Stop button
   */
  stop: {
    width: '32px',
    height: '32px',
    padding: 0,
    backgroundColor: colors.accent,
    border: 'none',
    borderRadius: borderRadius.md,
    color: colors.black,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: transition.normal,
    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)',
  } as CSSProperties,
} as const;

// =============================================================================
// Utility function to merge styles
// =============================================================================

/**
 * Merge multiple style objects together
 * Later styles override earlier ones
 */
export function mergeStyles(...styles: (CSSProperties | undefined | null | false)[]): CSSProperties {
  return Object.assign({}, ...styles.filter(Boolean));
}

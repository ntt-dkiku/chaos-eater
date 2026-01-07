/**
 * Common style objects for ChaosEater UI components
 * Use these to maintain consistency and reduce inline styles
 */
import type { CSSProperties } from 'react';
import { colors, spacing, borderRadius, fontSize, fontWeight, transition, boxShadow } from './theme';

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
    padding: spacing.md,
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: borderRadius.sm,
    color: colors.textPrimary,
    fontSize: fontSize.base,
    outline: 'none',
  } as CSSProperties,

  /**
   * Select dropdown style
   */
  select: {
    width: '100%',
    padding: `${spacing.sm} 36px ${spacing.sm} ${spacing.md}`,
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: borderRadius.sm,
    color: colors.textPrimary,
    fontSize: fontSize.base,
    cursor: 'pointer',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    outline: 'none',
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
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    display: 'block',
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
// Utility function to merge styles
// =============================================================================

/**
 * Merge multiple style objects together
 * Later styles override earlier ones
 */
export function mergeStyles(...styles: (CSSProperties | undefined | null | false)[]): CSSProperties {
  return Object.assign({}, ...styles.filter(Boolean));
}

/**
 * Hover event handlers for interactive elements
 * Use these with spread syntax: {...hoverHandlers.sidebarItem}
 */
import { colors } from './theme';

/**
 * Configuration for creating hover handlers
 */
export interface HoverConfig {
  /** Background color on hover */
  hoverBg?: string;
  /** Text color on hover */
  hoverColor?: string;
  /** Default background color */
  defaultBg?: string;
  /** Default text color */
  defaultColor?: string;
}

/**
 * Return type for hover handlers
 */
export interface HoverHandlers {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Create custom hover handlers with specified colors
 * @param config - Hover configuration
 * @returns Object with onMouseEnter and onMouseLeave handlers
 *
 * @example
 * ```tsx
 * const customHover = createHoverHandlers({
 *   hoverBg: '#333',
 *   hoverColor: '#fff',
 * });
 *
 * <button {...customHover}>Click me</button>
 * ```
 */
export function createHoverHandlers(config: HoverConfig = {}): HoverHandlers {
  const {
    hoverBg = colors.bgHover,
    hoverColor = colors.accent,
    defaultBg = colors.transparent,
    defaultColor = colors.textPrimary,
  } = config;

  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.backgroundColor = hoverBg;
      e.currentTarget.style.color = hoverColor;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.backgroundColor = defaultBg;
      e.currentTarget.style.color = defaultColor;
    },
  };
}

/**
 * Pre-defined hover handlers for common UI patterns
 */
export const hoverHandlers = {
  /**
   * Sidebar menu item hover
   * Background: #1a1a1a, Color: lime accent
   */
  sidebarItem: createHoverHandlers({
    hoverBg: colors.bgSidebarHover,
    hoverColor: colors.accent,
    defaultBg: colors.transparent,
    defaultColor: colors.textPrimary,
  }),

  /**
   * Icon button hover
   * Background: #2a2a2a, Color: lime accent
   */
  iconButton: createHoverHandlers({
    hoverBg: colors.bgHover,
    hoverColor: colors.accent,
    defaultBg: colors.transparent,
    defaultColor: colors.textLight,
  }),

  /**
   * Secondary button hover
   * Background: #2a2a2a, Color: lime accent
   */
  secondaryButton: createHoverHandlers({
    hoverBg: colors.bgHover,
    hoverColor: colors.accent,
    defaultBg: colors.bgTertiary,
    defaultColor: colors.textPrimary,
  }),

  /**
   * Card/panel hover
   * Slightly lighter background
   */
  card: createHoverHandlers({
    hoverBg: colors.bgHover,
    hoverColor: colors.textPrimary,
    defaultBg: colors.bgTertiary,
    defaultColor: colors.textPrimary,
  }),

  /**
   * Subtle text hover
   * Only changes text color to accent
   */
  textAccent: createHoverHandlers({
    hoverBg: colors.transparent,
    hoverColor: colors.accent,
    defaultBg: colors.transparent,
    defaultColor: colors.textSecondary,
  }),

  /**
   * Snapshot list item hover
   */
  snapshotItem: createHoverHandlers({
    hoverBg: colors.bgTertiary,
    hoverColor: colors.textPrimary,
    defaultBg: colors.transparent,
    defaultColor: colors.textPrimary,
  }),

  /**
   * Kebab menu item hover
   */
  menuItem: createHoverHandlers({
    hoverBg: colors.bgHover,
    hoverColor: colors.textPrimary,
    defaultBg: colors.transparent,
    defaultColor: colors.textPrimary,
  }),
} as const;

/**
 * Create hover handlers that only change background
 * Useful when text color should remain constant
 */
export function createBgOnlyHoverHandlers(
  hoverBg: string,
  defaultBg: string = colors.transparent
): Omit<HoverHandlers, never> {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.backgroundColor = hoverBg;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.backgroundColor = defaultBg;
    },
  };
}

/**
 * Create hover handlers that add a border highlight
 */
export function createBorderHoverHandlers(
  hoverBorder: string = `1px solid ${colors.accent}`,
  defaultBorder: string = `1px solid ${colors.border}`
): Omit<HoverHandlers, never> {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.border = hoverBorder;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.border = defaultBorder;
    },
  };
}

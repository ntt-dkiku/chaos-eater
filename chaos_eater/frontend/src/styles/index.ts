/**
 * ChaosEater UI Style System
 *
 * Usage:
 * ```tsx
 * import { colors, buttonStyles, hoverHandlers } from './styles';
 *
 * <button style={buttonStyles.ghost} {...hoverHandlers.sidebarItem}>
 *   Click me
 * </button>
 * ```
 */

// Theme constants
export {
  colors,
  spacing,
  borderRadius,
  fontSize,
  fontWeight,
  transition,
  boxShadow,
  zIndex,
  type Colors,
  type Spacing,
  type BorderRadius,
  type FontSize,
  type FontWeight,
  type Transition,
  type BoxShadow,
  type ZIndex,
} from './theme';

// Common style objects
export {
  buttonStyles,
  inputStyles,
  layoutStyles,
  containerStyles,
  textStyles,
  mergeStyles,
} from './commonStyles';

// Hover handlers
export {
  createHoverHandlers,
  createBgOnlyHoverHandlers,
  createBorderHoverHandlers,
  createFocusHandlers,
  hoverHandlers,
  focusHandlers,
  type HoverConfig,
  type HoverHandlers,
  type FocusHandlers,
} from './hoverHandlers';

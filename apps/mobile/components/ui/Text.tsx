import { Text as RNText, type TextProps } from 'react-native';

/**
 * Every amount on screen uses tabular figures so digits never shift the layout
 * as they change. Pass `tabular` on anything that renders a number.
 */
export const TABULAR = { fontVariant: ['tabular-nums' as const] };

export type EntoleTextProps = TextProps & {
  className?: string;
  tabular?: boolean;
};

export function Text({ tabular, style, className, ...rest }: EntoleTextProps) {
  return <RNText className={className} style={[tabular ? TABULAR : null, style]} {...rest} />;
}

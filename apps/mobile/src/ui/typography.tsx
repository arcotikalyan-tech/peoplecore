import type Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useContext, type ComponentProps } from 'react';
import type { TextProps } from 'react-native';
import { Text as BaseText } from '../text';
import { type, useTheme, type Colors, type TypeVariant } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type TextTone = 'fg' | 'muted' | 'faint' | 'primary' | 'danger' | 'success' | 'warning' | 'info' | 'onPrimary';

const toneColor = (c: Colors, tone: TextTone) => (tone === 'onPrimary' ? c.primaryFg : c[tone]);

// Text inside text keeps its parent's size and color unless it asks for its own.
const Nested = createContext(false);

/** Text in the type scale and the theme's colors (body text in the foreground color unless told otherwise). */
export function Text({ variant, tone, style, ...props }: TextProps & { variant?: TypeVariant; tone?: TextTone }) {
  const { colors } = useTheme();
  const nested = useContext(Nested);
  const scale = variant ? type[variant] : nested ? null : type.body;
  const color = tone ? toneColor(colors, tone) : nested ? null : colors.fg;
  return (
    <Nested.Provider value>
      <BaseText {...props} style={[scale, color ? { color } : null, style]} />
    </Nested.Provider>
  );
}

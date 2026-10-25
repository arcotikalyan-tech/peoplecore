import { requireOptionalNativeModule } from 'expo';
import { createContext, useContext } from 'react';
import { Text as NativeText, StyleSheet, type TextProps } from 'react-native';
import { baseWeight, drawnWeight } from './lib/text-weight';

// Android's Bold text setting as a weight to add (modules/bold-text); 0 on iOS, the web and Android before 12.
const boldText = requireOptionalNativeModule<{ adjustment(): number }>('PeopleCoreBoldText')?.adjustment() ?? 0;

// The weight of the text around a nested one, which it follows unless it sets its own.
const Surrounding = createContext(400);

/** React Native's Text, always with an explicit weight so Android draws it at the size it was measured (lib/text-weight). */
export function Text({ style, ...props }: TextProps) {
  const surrounding = useContext(Surrounding);
  const base = baseWeight(StyleSheet.flatten(style)?.fontWeight) ?? surrounding;
  return (
    <Surrounding.Provider value={base}>
      <NativeText {...props} style={[style, { fontWeight: drawnWeight(base, boldText) }]} />
    </Surrounding.Provider>
  );
}

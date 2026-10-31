import type {ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {colors} from '../../theme/colors';

export type SectionCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SectionCard({children, style}: SectionCardProps) {
  return <View style={[styles.sectionCard, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    shadowColor: colors.shadow,
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 3},
  },
});

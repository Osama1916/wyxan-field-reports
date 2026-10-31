import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {colors} from '../../theme/colors';

export type LoadingViewProps = {
  message?: string;
  accessibilityLabel?: string;
};

export function LoadingView({
  message = 'Loading…',
  accessibilityLabel,
}: LoadingViewProps) {
  return (
    <View
      style={styles.centered}
      accessibilityLabel={accessibilityLabel ?? message}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  message: {
    color: colors.inkMuted,
    fontSize: 14,
  },
});

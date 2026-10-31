import type {ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors} from '../../theme/colors';

export type ErrorViewProps = {
  title?: string;
  message: string;
  hint?: string;
  accessibilityLabel?: string;
  testID?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retryDisabled?: boolean;
  footer?: ReactNode;
};

export function ErrorView({
  title,
  message,
  hint,
  accessibilityLabel,
  testID,
  onRetry,
  retryLabel = 'Try again',
  retryDisabled = false,
  footer,
}: ErrorViewProps) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={styles.errorBox}>
      {title ? <Text style={styles.errorTitle}>{title}</Text> : null}
      <Text style={styles.errorText}>{message}</Text>
      {hint ? <Text style={styles.errorHint}>{hint}</Text> : null}
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          disabled={retryDisabled}
          onPress={onRetry}
          style={({pressed}) => [
            styles.errorRetry,
            retryDisabled && styles.disabled,
            pressed && !retryDisabled && styles.pressed,
          ]}>
          <Text style={styles.errorRetryLabel}>{retryLabel}</Text>
        </Pressable>
      ) : null}
      {footer}
    </View>
  );
}

export type SuccessViewProps = {
  title: string;
  message: string;
  accessibilityLabel?: string;
  testID?: string;
  onDismiss?: () => void;
  dismissLabel?: string;
};

export function SuccessView({
  title,
  message,
  accessibilityLabel,
  testID,
  onDismiss,
  dismissLabel = 'Dismiss',
}: SuccessViewProps) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={styles.successBox}>
      <Text style={styles.successTitle}>{title}</Text>
      <Text style={styles.successText}>{message}</Text>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
          onPress={onDismiss}
          style={({pressed}) => [
            styles.successDismiss,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.successDismissLabel}>{dismissLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    gap: 8,
  },
  errorTitle: {
    color: '#7a1212',
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: '#7a1212',
    fontSize: 13,
    lineHeight: 18,
  },
  errorHint: {
    color: '#7a1212',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  errorRetry: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.danger,
  },
  errorRetryLabel: {
    color: colors.inkInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  successBox: {
    backgroundColor: colors.uploadedBg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#B7E0C8',
    gap: 8,
  },
  successTitle: {
    color: colors.uploadedText,
    fontSize: 15,
    fontWeight: '800',
  },
  successText: {
    color: colors.uploadedText,
    fontSize: 13,
    lineHeight: 18,
  },
  successDismiss: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.uploadedText,
  },
  successDismissLabel: {
    color: colors.inkInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
  },
});

import type {ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {colors} from '../../theme/colors';

export type AppButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'dangerOutline'
  | 'link'
  | 'hero'
  | 'success';

export type AppButtonProps = {
  label: string;
  onPress: () => void;
  variant?: AppButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  testID,
  style,
  children,
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      testID={testID}
      onPress={onPress}
      style={({pressed}) => [
        styles.base,
        variantStyle.button,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variantStyle.spinner}
          size="small"
          style={styles.spinner}
        />
      ) : null}
      {/* Hero chips show spinner only while busy; other variants keep a label. */}
      {loading && variant === 'hero'
        ? null
        : (children ?? (
            <Text style={[styles.label, variantStyle.label]}>{label}</Text>
          ))}
    </Pressable>
  );
}

const VARIANT_STYLES: Record<
  AppButtonVariant,
  {
    button: object;
    label: object;
    spinner: string;
  }
> = {
  primary: {
    button: {
      backgroundColor: colors.primary,
      minHeight: 54,
      borderRadius: 14,
      paddingVertical: 16,
      elevation: 3,
      shadowColor: colors.primaryDark,
      shadowOpacity: 0.28,
      shadowRadius: 8,
      shadowOffset: {width: 0, height: 4},
    },
    label: {
      color: colors.inkInverse,
      fontSize: 16,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    spinner: colors.inkInverse,
  },
  secondary: {
    button: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 10,
      minHeight: 48,
    },
    label: {
      color: colors.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    spinner: colors.primary,
  },
  danger: {
    button: {
      backgroundColor: colors.danger,
      minHeight: 48,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    label: {
      color: colors.inkInverse,
      fontWeight: '800',
      fontSize: 15,
    },
    spinner: colors.inkInverse,
  },
  dangerOutline: {
    button: {
      backgroundColor: colors.dangerSoft,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dangerBorder,
      paddingVertical: 10,
      paddingHorizontal: 14,
      minHeight: 44,
      minWidth: 44,
    },
    label: {
      color: colors.danger,
      fontWeight: '800',
      fontSize: 13,
    },
    spinner: colors.danger,
  },
  link: {
    button: {
      backgroundColor: 'transparent',
      paddingVertical: 12,
      minHeight: 40,
    },
    label: {
      color: colors.primaryDark,
      fontSize: 15,
      fontWeight: '700',
    },
    spinner: colors.primary,
  },
  hero: {
    button: {
      minHeight: 40,
      minWidth: 72,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.16)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.22)',
    },
    label: {
      color: colors.inkInverse,
      fontWeight: '700',
      fontSize: 14,
    },
    spinner: colors.inkInverse,
  },
  success: {
    button: {
      alignSelf: 'flex-start',
      marginTop: 4,
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: colors.uploadedText,
      minHeight: 36,
    },
    label: {
      color: colors.inkInverse,
      fontWeight: '700',
      fontSize: 13,
    },
    spinner: colors.inkInverse,
  },
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  label: {
    textAlign: 'center',
  },
  spinner: {
    marginRight: 0,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.88,
    transform: [{scale: 0.99}],
  },
});

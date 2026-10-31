import type {ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors} from '../../theme/colors';

export type AppHeaderProps = {
  title: string;
  subtitle?: string;
  topInset: number;
  /** Brand mark row (create screen) or custom left content. */
  showBrand?: boolean;
  brandAccessory?: ReactNode;
  onBack?: () => void;
  backDisabled?: boolean;
  right?: ReactNode;
  footer?: ReactNode;
  glowPosition?: 'topRight' | 'bottomLeft' | 'bottomRight';
};

export function AppHeader({
  title,
  subtitle,
  topInset,
  showBrand = false,
  brandAccessory,
  onBack,
  backDisabled = false,
  right,
  footer,
  glowPosition = 'topRight',
}: AppHeaderProps) {
  return (
    <View style={[styles.hero, {paddingTop: topInset + (onBack ? 10 : 16)}]}>
      <View
        style={[
          styles.heroGlow,
          glowPosition === 'bottomLeft' && styles.glowBottomLeft,
          glowPosition === 'bottomRight' && styles.glowBottomRight,
        ]}
      />

      {showBrand ? (
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>FR</Text>
          </View>
          <Text style={styles.brandName}>FieldReports</Text>
          {brandAccessory}
        </View>
      ) : null}

      {onBack || right ? (
        <View style={styles.topBar}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              disabled={backDisabled}
              onPress={onBack}
              style={({pressed}) => [
                styles.backButton,
                backDisabled && styles.disabled,
                pressed && !backDisabled && styles.pressed,
              ]}>
              <Text style={styles.backChevron}>‹</Text>
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
          ) : (
            <View />
          )}
          {right ? <View style={styles.topActions}>{right}</View> : null}
        </View>
      ) : null}

      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.bgDeep,
    paddingHorizontal: 20,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    right: -40,
    top: -30,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.bgDeepMid,
    opacity: 0.55,
  },
  glowBottomLeft: {
    right: undefined,
    top: undefined,
    left: -50,
    bottom: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.5,
  },
  glowBottomRight: {
    right: -40,
    top: undefined,
    bottom: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    opacity: 0.5,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
    paddingHorizontal: 2,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.4,
  },
  brandName: {
    flex: 1,
    color: colors.inkInverse,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
    opacity: 0.92,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    minHeight: 44,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 40,
    minWidth: 84,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  backChevron: {
    color: colors.inkInverse,
    fontSize: 26,
    fontWeight: '600',
    lineHeight: 28,
    marginTop: -2,
  },
  backLabel: {
    color: colors.inkInverse,
    fontWeight: '700',
    fontSize: 15,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.inkInverse,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 20,
    maxWidth: 340,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
  },
});

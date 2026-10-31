import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors} from '../../theme/colors';
import {
  ServerReportCard,
  type ServerReviewItem,
} from './ServerReportCard';

export type ServerReviewPanelProps = {
  reports: ServerReviewItem[];
  error: string | null;
  busy: boolean;
  expanded: boolean;
  previewCount: number;
  onRefresh: () => void;
  onToggleExpanded: () => void;
};

export function ServerReviewPanel({
  reports,
  error,
  busy,
  expanded,
  previewCount,
  onRefresh,
  onToggleExpanded,
}: ServerReviewPanelProps) {
  const visibleReports = expanded ? reports : reports.slice(0, previewCount);
  const hiddenCount = Math.max(0, reports.length - previewCount);

  return (
    <View style={styles.serverReviewCard}>
      <View style={styles.serverReviewHeader}>
        <View style={styles.serverReviewHeaderGlow} />
        <View style={styles.serverReviewHeaderTop}>
          <View style={styles.serverReviewIcon}>
            <Text style={styles.serverReviewIconText}>SV</Text>
          </View>
          <View style={styles.serverReviewHeaderText}>
            <Text style={styles.serverReviewTitle}>Server review</Text>
            <Text style={styles.serverReviewSubtitle}>
              Live confirmations from the backend
            </Text>
          </View>
          <View
            style={[
              styles.serverCountPill,
              reports.length === 0 && styles.serverCountPillEmpty,
            ]}>
            <Text style={styles.serverCountPillText}>{reports.length}</Text>
          </View>
        </View>
      </View>

      <View style={styles.serverReviewBody}>
        {error && reports.length === 0 ? (
          <View style={styles.serverEmptyBox}>
            <Text style={styles.serverEmptyTitle}>Could not reach server</Text>
            <Text style={styles.serverEmptyBody}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onRefresh}
              style={({pressed}) => [
                styles.serverRefreshChip,
                busy && styles.disabled,
                pressed && !busy && styles.pressed,
              ]}>
              <Text style={styles.serverRefreshChipLabel}>Refresh</Text>
            </Pressable>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.serverEmptyBox}>
            <View style={styles.serverEmptyMark}>
              <Text style={styles.serverEmptyMarkText}>0</Text>
            </View>
            <Text style={styles.serverEmptyTitle}>Nothing synced yet</Text>
            <Text style={styles.serverEmptyBody}>
              When a report uploads successfully, it will show here from the
              server — not just from this phone.
            </Text>
          </View>
        ) : (
          <>
            {error ? (
              <View style={styles.serverEmptyBox}>
                <Text style={styles.serverEmptyTitle}>
                  Could not refresh server
                </Text>
                <Text style={styles.serverEmptyBody}>{error}</Text>
                <Text style={styles.serverEmptyBody}>
                  Showing last confirmed results.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={onRefresh}
                  style={({pressed}) => [
                    styles.serverRefreshChip,
                    busy && styles.disabled,
                    pressed && !busy && styles.pressed,
                  ]}>
                  <Text style={styles.serverRefreshChipLabel}>Refresh</Text>
                </Pressable>
              </View>
            ) : null}
            {visibleReports.map((item, index) => (
              <ServerReportCard key={item.id} item={item} rank={index + 1} />
            ))}
            {hiddenCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  expanded
                    ? 'Show fewer server reports'
                    : `Expand server review, ${hiddenCount} more`
                }
                accessibilityState={{expanded}}
                testID="expand-server-review"
                onPress={onToggleExpanded}
                style={({pressed}) => [
                  styles.expandListButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.expandListButtonLabel}>
                  {expanded ? 'Show less' : `Expand · ${hiddenCount} more`}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  serverReviewCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
  },
  serverReviewHeader: {
    backgroundColor: colors.bgDeep,
    paddingHorizontal: 16,
    paddingVertical: 16,
    overflow: 'hidden',
  },
  serverReviewHeaderGlow: {
    position: 'absolute',
    right: -30,
    top: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.bgDeepMid,
    opacity: 0.55,
  },
  serverReviewHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  serverReviewIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverReviewIconText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: 0.4,
  },
  serverReviewHeaderText: {
    flex: 1,
    gap: 2,
  },
  serverReviewTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.inkInverse,
    letterSpacing: -0.2,
  },
  serverReviewSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 16,
  },
  serverCountPill: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  serverCountPillEmpty: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  serverCountPillText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  serverReviewBody: {
    padding: 14,
    gap: 10,
    backgroundColor: colors.surfaceMuted,
  },
  serverEmptyBox: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  serverEmptyMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  serverEmptyMarkText: {
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: '800',
  },
  serverEmptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
  },
  serverEmptyBody: {
    fontSize: 13,
    color: colors.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  serverRefreshChip: {
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  serverRefreshChipLabel: {
    color: colors.inkInverse,
    fontWeight: '800',
    fontSize: 13,
  },
  expandListButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  expandListButtonLabel: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
  },
});

import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  AppButton,
  AppHeader,
  EmptyState,
  ErrorView,
  LoadingView,
  SuccessView,
} from '../components/common';
import {ReportCard, ServerReviewPanel} from '../components/reports';
import {
  SERVER_REVIEW_PREVIEW_COUNT,
  useSavedReports,
} from '../hooks/useSavedReports';
import {colors} from '../theme/colors';

type Props = {
  highlightReportId?: number | null;
  onBack: () => void;
  onRefreshRequest?: number;
  onOpenSettings?: () => void;
};

export function SavedReportsScreen({
  highlightReportId,
  onBack,
  onRefreshRequest = 0,
  onOpenSettings,
}: Props) {
  const insets = useSafeAreaInsets();
  const state = useSavedReports({highlightReportId, onRefreshRequest});

  return (
    <View style={[styles.root, {paddingBottom: insets.bottom + 8}]}>
      <AppHeader
        title="My Reports"
        subtitle="Your saved reports and upload status"
        topInset={insets.top}
        onBack={onBack}
        glowPosition="bottomLeft"
        right={
          <>
            {onOpenSettings ? (
              <AppButton
                label="Settings"
                variant="hero"
                disabled={state.busy}
                accessibilityLabel="Open settings"
                testID="open-settings"
                onPress={onOpenSettings}
              />
            ) : null}
            <AppButton
              label="Sync"
              variant="hero"
              disabled={state.busy}
              loading={state.syncing}
              onPress={() => void state.onSync()}
            />
            <AppButton
              label="Reload"
              variant="hero"
              disabled={state.busy}
              loading={(state.reloading || state.serverRefreshing) && !state.syncing}
              accessibilityLabel="Reload reports"
              testID="reload-reports"
              onPress={() => void state.onManualReload()}
            />
          </>
        }
        footer={
          state.reports.length > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>
                {state.reports.length} saved{' '}
                {state.reports.length === 1 ? 'report' : 'reports'}
              </Text>
            </View>
          ) : null
        }
      />

      {state.loading && state.reports.length === 0 ? (
        <LoadingView
          message="Loading your reports…"
          accessibilityLabel="Loading reports"
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          {state.error ? (
            <ErrorView
              title="Could not load reports"
              message={state.error}
              accessibilityLabel="Saved reports error"
              onRetry={() => void state.onManualReload()}
              retryDisabled={state.busy}
            />
          ) : null}

          {state.actionNotice ? (
            state.actionNotice.type === 'success' ? (
              <SuccessView
                title="Deleted"
                message={state.actionNotice.message}
                accessibilityLabel="Delete success"
                testID="delete-success-notice"
                onDismiss={() => state.setActionNotice(null)}
              />
            ) : (
              <ErrorView
                title="Could not delete report"
                message={state.actionNotice.message}
                hint="The report is still on this device. You can try Delete again."
                accessibilityLabel="Delete error"
                testID="delete-error-notice"
                onRetry={() => state.setActionNotice(null)}
                retryLabel="Dismiss"
              />
            )
          ) : null}

          {state.reports.length === 0 && !state.error ? (
            <EmptyState
              title="No reports yet"
              body="Saved reports will appear here after you create one on this device."
              action={
                <AppButton
                  label="Create a report"
                  variant="primary"
                  onPress={onBack}
                  style={styles.emptyAction}
                />
              }
            />
          ) : null}

          <ServerReviewPanel
            reports={state.serverReports}
            error={state.serverReviewError}
            busy={state.busy}
            expanded={state.serverReviewExpanded}
            previewCount={SERVER_REVIEW_PREVIEW_COUNT}
            onRefresh={() => void state.loadServerReview()}
            onToggleExpanded={() =>
              state.setServerReviewExpanded(current => !current)
            }
          />

          {state.reports.length > 0 ? (
            <View style={styles.localReportsSectionHeader}>
              <Text style={styles.localReportsSectionTitle}>
                On this device
              </Text>
              <Text style={styles.localReportsSectionCount}>
                {state.reports.length}
              </Text>
            </View>
          ) : null}

          {state.visibleLocalReports.map(report => (
            <ReportCard
              key={report.id}
              report={report}
              highlighted={report.id === highlightReportId}
              retrying={state.retryingId === report.id}
              deleting={state.deletingId === report.id}
              onRetry={id => void state.onRetryReport(id)}
              onRequestDelete={state.onRequestDelete}
            />
          ))}

          {state.hiddenLocalCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                state.localReportsExpanded
                  ? 'Show fewer saved reports'
                  : `Expand saved reports, ${state.hiddenLocalCount} more`
              }
              accessibilityState={{expanded: state.localReportsExpanded}}
              testID="expand-local-reports"
              onPress={() =>
                state.setLocalReportsExpanded(current => !current)
              }
              style={({pressed}) => [
                styles.expandListButton,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.expandListButtonLabel}>
                {state.localReportsExpanded
                  ? 'Show less'
                  : `Expand · ${state.hiddenLocalCount} more`}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 14,
  },
  countPill: {
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countPillText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  emptyAction: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 22,
    elevation: 0,
    shadowOpacity: 0,
  },
  localReportsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  localReportsSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
  },
  localReportsSectionCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 8,
    backgroundColor: colors.primarySoft,
    color: colors.primaryDark,
    overflow: 'hidden',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 28,
    textAlign: 'center',
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
    marginTop: 2,
  },
  expandListButtonLabel: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.82,
  },
});

import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  AppButton,
  AppHeader,
  ErrorView,
  SectionCard,
  SuccessView,
} from '../components/common';
import {useSettingsReset} from '../hooks/useSettingsReset';
import {colors} from '../theme/colors';

type Props = {
  onBack: () => void;
};

export function SettingsScreen({onBack}: Props) {
  const insets = useSafeAreaInsets();
  const {resetting, error, success, onRequestReset} = useSettingsReset();

  return (
    <View style={[styles.root, {paddingBottom: insets.bottom + 8}]}>
      <AppHeader
        title="Settings"
        subtitle="App preferences and destructive maintenance actions"
        topInset={insets.top}
        onBack={onBack}
        backDisabled={resetting}
        glowPosition="bottomRight"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <SectionCard>
          <Text style={styles.sectionEyebrow}>Danger zone</Text>
          <Text style={styles.sectionTitle}>Reset</Text>
          <Text style={styles.sectionBody}>
            Permanently delete every field report on this device and on the
            server, including queued uploads and stored photos. Network access
            is required. Backend chaos simulation settings are not changed.
          </Text>

          <AppButton
            label={resetting ? 'Resetting…' : 'Reset all reports'}
            variant="danger"
            accessibilityLabel="Reset all reports"
            testID="reset-all-reports"
            disabled={resetting}
            loading={resetting}
            onPress={onRequestReset}
            style={styles.resetButton}
          />
        </SectionCard>

        {success ? (
          <SuccessView
            title="Reset complete"
            message={success}
            accessibilityLabel="Reset success"
            testID="reset-success-notice"
          />
        ) : null}

        {error ? (
          <ErrorView
            title="Could not finish reset"
            message={error}
            hint="Nothing was marked successful unless both server and local wipe completed. You can retry when the network is available and no uploads are running."
            accessibilityLabel="Reset error"
            testID="reset-error-notice"
            onRetry={onRequestReset}
            retryDisabled={resetting}
          />
        ) : null}
      </ScrollView>
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
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.danger,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
  },
  sectionBody: {
    fontSize: 14,
    color: colors.inkSecondary,
    lineHeight: 21,
  },
  resetButton: {
    marginTop: 6,
  },
});

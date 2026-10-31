import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AppButton, AppHeader, ErrorView} from '../components/common';
import {PhotoPicker, ReportDescriptionInput} from '../components/reports';
import {useCreateReportForm} from '../hooks/useCreateReportForm';
import {colors} from '../theme/colors';

type Props = {
  onSaved: (reportId: number) => void;
  onViewSaved: () => void;
  onOpenSettings?: () => void;
};

export function CreateReportScreen({
  onSaved,
  onViewSaved,
  onOpenSettings,
}: Props) {
  const insets = useSafeAreaInsets();
  const form = useCreateReportForm({onSaved});

  return (
    <View style={[styles.root, {paddingBottom: insets.bottom + 8}]}>
      <AppHeader
        title="Create report"
        subtitle="Capture the issue with a clear description and photos. Everything saves on this device first."
        topInset={insets.top}
        showBrand
        brandAccessory={
          onOpenSettings ? (
            <AppButton
              label="Settings"
              variant="hero"
              disabled={form.busy}
              accessibilityLabel="Open settings"
              testID="open-settings"
              onPress={onOpenSettings}
              style={styles.settingsChip}
            />
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}>
        <ReportDescriptionInput
          value={form.description}
          error={form.descriptionError}
          editable={!form.busy}
          onChangeText={form.onChangeDescription}
        />

        <PhotoPicker
          photos={form.photos}
          busy={form.busy}
          processingMessage={form.processingMessage}
          onCamera={() => void form.onCamera()}
          onGallery={() => void form.onGallery()}
          onRemovePhoto={form.onRemovePhoto}
        />

        {form.error && form.error !== form.descriptionError ? (
          <ErrorView
            message={form.error}
            accessibilityLabel="Create report error"
          />
        ) : null}

        <AppButton
          label={form.saving ? 'Saving…' : 'Save Report'}
          variant="primary"
          disabled={form.busy}
          loading={form.saving}
          onPress={() => void form.onSave()}
        />

        <AppButton
          label="View saved reports"
          variant="link"
          disabled={form.busy}
          onPress={onViewSaved}
        />
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
    paddingBottom: 36,
    gap: 14,
  },
  settingsChip: {
    borderColor: 'rgba(255,255,255,0.28)',
    minHeight: 36,
  },
});

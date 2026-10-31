import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {MAX_PHOTOS} from '../../reports/constants';
import type {SelectedPhoto} from '../../reports/types';
import {colors} from '../../theme/colors';
import {SectionCard} from '../common/SectionCard';
import {PhotoPreviewList} from './PhotoPreviewList';

export type PhotoPickerProps = {
  photos: SelectedPhoto[];
  busy: boolean;
  processingMessage: string | null;
  onCamera: () => void;
  onGallery: () => void;
  onRemovePhoto: (selectionId: string) => void;
};

export function PhotoPicker({
  photos,
  busy,
  processingMessage,
  onCamera,
  onGallery,
  onRemovePhoto,
}: PhotoPickerProps) {
  const photosFull = photos.length >= MAX_PHOTOS;

  return (
    <SectionCard>
      <View style={styles.photoHeader}>
        <View>
          <Text style={styles.label}>Photos</Text>
          <Text style={styles.helperText}>
            Add 1–5 images. Larger photos are compressed under 5 MB.
          </Text>
        </View>
        <View style={styles.photoCountPill}>
          <Text style={styles.photoCount}>
            {photos.length}/{MAX_PHOTOS}
          </Text>
        </View>
      </View>

      {processingMessage ? (
        <View
          accessibilityLabel={processingMessage}
          style={styles.processingRow}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.processingText}>{processingMessage}</Text>
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || photosFull}
          onPress={onCamera}
          style={({pressed}) => [
            styles.secondaryButton,
            (busy || photosFull) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}>
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>Cam</Text>
          </View>
          <Text style={styles.secondaryLabel}>Camera</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || photosFull}
          onPress={onGallery}
          style={({pressed}) => [
            styles.secondaryButton,
            (busy || photosFull) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}>
          <View style={[styles.actionIcon, styles.actionIconAlt]}>
            <Text style={styles.actionIconTextAlt}>Gal</Text>
          </View>
          <Text style={styles.secondaryLabel}>Gallery</Text>
        </Pressable>
      </View>

      <PhotoPreviewList
        photos={photos}
        busy={busy}
        onRemove={onRemovePhoto}
      />
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  photoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: 0.2,
  },
  helperText: {
    fontSize: 13,
    color: colors.inkMuted,
    lineHeight: 18,
  },
  photoCountPill: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  photoCount: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  processingText: {
    flex: 1,
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 8,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconAlt: {
    backgroundColor: colors.accentSoft,
  },
  actionIconText: {
    color: colors.inkInverse,
    fontWeight: '800',
    fontSize: 11,
  },
  actionIconTextAlt: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 11,
  },
  secondaryLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.88,
    transform: [{scale: 0.99}],
  },
});

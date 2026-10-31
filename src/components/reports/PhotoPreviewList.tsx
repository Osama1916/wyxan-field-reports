import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import type {SelectedPhoto} from '../../reports/types';
import {colors} from '../../theme/colors';

export type PhotoPreviewListProps = {
  photos: SelectedPhoto[];
  busy?: boolean;
  onRemove: (selectionId: string) => void;
};

export function PhotoPreviewList({
  photos,
  busy = false,
  onRemove,
}: PhotoPreviewListProps) {
  if (photos.length === 0) {
    return (
      <View style={styles.dropZone}>
        <Text style={styles.dropZoneTitle}>No photos yet</Text>
        <Text style={styles.hint}>
          Use Camera or Gallery to attach evidence of the issue.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.previewGrid}>
      {photos.map(photo => (
        <View key={photo.selectionId} style={styles.previewCard}>
          <Image
            accessibilityLabel={`Selected photo ${photo.fileName ?? photo.selectionId}`}
            source={{uri: photo.uri}}
            style={styles.previewImage}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
            disabled={busy}
            onPress={() => onRemove(photo.selectionId)}
            style={styles.removeButton}>
            <Text style={styles.removeLabel}>Remove</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dropZone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    gap: 6,
  },
  dropZoneTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.inkSecondary,
  },
  hint: {
    color: colors.inkMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  previewCard: {
    width: '47%',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewImage: {
    width: '100%',
    height: 124,
    backgroundColor: colors.surfaceSoft,
  },
  removeButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  removeLabel: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
});

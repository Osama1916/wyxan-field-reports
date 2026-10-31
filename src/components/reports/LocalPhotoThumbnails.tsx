import {Image, StyleSheet, Text, View} from 'react-native';
import type {LocalReportPhoto} from '../../db';
import {colors} from '../../theme/colors';

export type LocalPhotoThumbnailsProps = {
  photos: LocalReportPhoto[];
};

export function LocalPhotoThumbnails({photos}: LocalPhotoThumbnailsProps) {
  if (photos.length === 0) {
    return <Text style={styles.mutedSmall}>No photos attached</Text>;
  }

  return (
    <View style={styles.thumbRow}>
      {photos.map(photo => (
        <View key={photo.id} style={styles.thumbFrame}>
          <Image
            accessibilityLabel={`Photo ${photo.sortOrder + 1} of ${photos.length}`}
            source={{uri: photo.localUri}}
            style={styles.thumb}
          />
          <View style={styles.thumbIndex}>
            <Text style={styles.thumbIndexLabel}>{photo.sortOrder + 1}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mutedSmall: {
    color: colors.inkMuted,
    fontSize: 13,
  },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  thumbFrame: {
    width: '30.5%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbIndex: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(12,31,30,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  thumbIndexLabel: {
    color: colors.inkInverse,
    fontSize: 11,
    fontWeight: '800',
  },
});

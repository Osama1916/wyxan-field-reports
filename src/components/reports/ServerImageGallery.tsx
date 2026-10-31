import {useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {resolveServerImageUrl, type ServerReportImage} from '../../api';
import {colors} from '../../theme/colors';

export type ServerImageGalleryProps = {
  reportId: string;
  images: ServerReportImage[];
};

function ServerReviewImageThumb({
  reportId,
  image,
  index,
  total,
}: {
  reportId: string;
  image: ServerReportImage;
  index: number;
  total: number;
}) {
  const [failed, setFailed] = useState(false);
  const uri = resolveServerImageUrl(image.url);

  if (!uri || failed) {
    return (
      <View
        accessibilityLabel={`Server image ${index + 1} unavailable`}
        testID={`server-review-image-fallback-${reportId}-${image.sortOrder}`}
        style={[styles.serverThumb, styles.serverThumbFallback]}>
        <Text style={styles.serverThumbFallbackLabel}>—</Text>
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={`Server image ${index + 1} of ${total}`}
      testID={`server-review-image-${reportId}-${image.sortOrder}`}
      source={{uri}}
      resizeMode="cover"
      onError={() => setFailed(true)}
      style={styles.serverThumb}
    />
  );
}

export function ServerImageGallery({
  reportId,
  images,
}: ServerImageGalleryProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <View
      accessibilityLabel={`${images.length} server images`}
      style={styles.serverThumbRow}>
      {images.map((image, imageIndex) => (
        <ServerReviewImageThumb
          key={image.id}
          reportId={reportId}
          image={image}
          index={imageIndex}
          total={images.length}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  serverThumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  serverThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  serverThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  serverThumbFallbackLabel: {
    color: colors.inkMuted,
    fontSize: 16,
    fontWeight: '700',
  },
});

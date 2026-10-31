import {StyleSheet, Text, View} from 'react-native';
import type {ServerReportImage, ServerReportSummary} from '../../api';
import {formatCreatedAt} from '../../utils/formatDate';
import {colors} from '../../theme/colors';
import {ServerImageGallery} from './ServerImageGallery';

export type ServerReviewItem = ServerReportSummary & {
  images: ServerReportImage[];
};

export type ServerReportCardProps = {
  item: ServerReviewItem;
  rank: number;
};

export function ServerReportCard({item, rank}: ServerReportCardProps) {
  return (
    <View style={styles.serverReviewRow}>
      <View style={styles.serverReviewRowAccent} />
      <View style={styles.serverReviewRowBody}>
        <View style={styles.serverReviewRowTop}>
          <Text style={styles.serverReviewRank}>#{rank}</Text>
          <View style={styles.serverLiveBadge}>
            <View style={styles.serverLiveDot} />
            <Text style={styles.serverLiveLabel}>Confirmed</Text>
          </View>
        </View>
        <Text
          testID={`server-review-desc-${item.id}`}
          style={styles.serverReviewDesc}
          numberOfLines={2}>
          {item.description}
        </Text>
        <ServerImageGallery reportId={item.id} images={item.images} />
        <View style={styles.serverMetaRow}>
          <View style={styles.serverMetaChip}>
            <Text style={styles.serverMetaChipText}>
              {formatCreatedAt(item.createdAt)}
            </Text>
          </View>
          <View style={styles.serverMetaChip}>
            <Text
              testID={`server-review-image-count-${item.id}`}
              style={styles.serverMetaChipText}>
              {item.imageCount}{' '}
              {item.imageCount === 1 ? 'image' : 'images'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  serverReviewRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  serverReviewRowAccent: {
    width: 4,
    backgroundColor: colors.accent,
  },
  serverReviewRowBody: {
    flex: 1,
    padding: 12,
    gap: 6,
  },
  serverReviewRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  serverReviewRank: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  serverLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.uploadedBg,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  serverLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.uploadedText,
  },
  serverLiveLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.uploadedText,
  },
  serverReviewDesc: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 21,
  },
  serverMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  serverMetaChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  serverMetaChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.inkSecondary,
  },
});

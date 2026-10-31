import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {LocalReportWithPhotos} from '../../db';
import {formatCreatedAt} from '../../utils/formatDate';
import {colors} from '../../theme/colors';
import {TrashIcon} from '../common/TrashIcon';
import {ExpandableDescription} from './ExpandableDescription';
import {LocalPhotoThumbnails} from './LocalPhotoThumbnails';
import {ReportStatusBadge, STATUS_LABELS} from './ReportStatusBadge';

export type ReportCardProps = {
  report: LocalReportWithPhotos;
  highlighted: boolean;
  retrying: boolean;
  deleting: boolean;
  onRetry: (reportId: number) => void;
  onRequestDelete: (reportId: number) => void;
};

export function ReportCard({
  report,
  highlighted,
  retrying,
  deleting,
  onRetry,
  onRequestDelete,
}: ReportCardProps) {
  const photoCount = report.photos.length;
  const showRetry =
    report.status === 'failed' ||
    (report.status === 'pending' && report.lastError != null);
  const canDelete =
    report.status === 'pending' || report.status === 'failed';
  const showDeleteBlockedUploading = report.status === 'uploading';
  const actionsDisabled = retrying || deleting;

  return (
    <View
      style={[styles.card, highlighted && styles.cardHighlighted]}
      accessibilityLabel={`Report ${report.id}, ${STATUS_LABELS[report.status]}`}>
      <View style={styles.cardAccent} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleBlock}>
            <Text style={styles.cardEyebrow}>Field report</Text>
            <Text style={styles.cardTitle}>Report #{report.id}</Text>
          </View>
          <ReportStatusBadge status={report.status} />
        </View>

        <ExpandableDescription text={report.description} />

        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Text style={styles.metaText}>
              {formatCreatedAt(report.createdAt)}
            </Text>
          </View>
          <View style={styles.metaChip}>
            <Text style={styles.metaText}>
              {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
            </Text>
          </View>
          {report.status === 'uploaded' ? (
            <View style={[styles.metaChip, styles.metaChipUploaded]}>
              <Text style={[styles.metaText, styles.metaTextUploaded]}>
                {report.serverReportId ? 'Uploaded to server' : 'Uploaded'}
              </Text>
            </View>
          ) : null}
        </View>

        {report.lastError && report.status !== 'uploaded' ? (
          <Text style={styles.cardError} numberOfLines={3}>
            {report.lastError}
          </Text>
        ) : null}

        <LocalPhotoThumbnails photos={report.photos} />

        <View style={styles.cardActions}>
          {showRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retry upload for report ${report.id}`}
              disabled={actionsDisabled}
              onPress={() => onRetry(report.id)}
              style={({pressed}) => [
                styles.retryButton,
                actionsDisabled && styles.disabled,
                pressed && !actionsDisabled && styles.pressed,
              ]}>
              {retrying ? (
                <ActivityIndicator color={colors.inkInverse} size="small" />
              ) : (
                <Text style={styles.retryButtonLabel}>Retry upload</Text>
              )}
            </Pressable>
          ) : null}

          {canDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete report ${report.id}`}
              accessibilityState={{disabled: actionsDisabled, busy: deleting}}
              disabled={actionsDisabled}
              testID={`delete-report-${report.id}`}
              hitSlop={4}
              onPress={() => onRequestDelete(report.id)}
              style={({pressed}) => [
                styles.deleteButton,
                actionsDisabled && styles.disabled,
                pressed && !actionsDisabled && styles.pressed,
              ]}>
              {deleting ? (
                <View style={styles.deleteButtonInner}>
                  <ActivityIndicator color={colors.danger} size="small" />
                  <Text style={styles.deleteButtonLabel}>Deleting...</Text>
                </View>
              ) : (
                <View style={styles.deleteButtonInner}>
                  <TrashIcon color={colors.danger} />
                  <Text style={styles.deleteButtonLabel}>Delete</Text>
                </View>
              )}
            </Pressable>
          ) : null}

          {showDeleteBlockedUploading ? (
            <Text
              testID={`delete-blocked-${report.id}`}
              style={styles.deleteBlockedHint}>
              Cannot delete while uploading
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    flexDirection: 'row',
    elevation: 3,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
  },
  cardHighlighted: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  cardAccent: {
    width: 5,
    backgroundColor: colors.primary,
  },
  cardBody: {
    flex: 1,
    padding: 16,
    gap: 11,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitleBlock: {
    flex: 1,
    gap: 2,
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaText: {
    fontSize: 12,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  metaChipUploaded: {
    backgroundColor: colors.uploadedBg,
    borderColor: '#B7E0C8',
  },
  metaTextUploaded: {
    color: colors.uploadedText,
  },
  cardError: {
    color: colors.failedText,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonLabel: {
    color: colors.inkInverse,
    fontWeight: '800',
    fontSize: 13,
  },
  deleteButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.dangerSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteButtonLabel: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 13,
  },
  deleteBlockedHint: {
    flexBasis: '100%',
    color: colors.uploadingText,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
  },
});

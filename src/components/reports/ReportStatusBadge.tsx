import {StyleSheet, Text, View} from 'react-native';
import type {ReportStatus} from '../../db';
import {colors} from '../../theme/colors';

export const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  failed: 'Failed',
};

const STATUS_DOT: Record<ReportStatus, string> = {
  pending: colors.pendingText,
  uploading: colors.uploadingText,
  uploaded: colors.uploadedText,
  failed: colors.failedText,
};

export type ReportStatusBadgeProps = {
  status: ReportStatus;
};

export function ReportStatusBadge({status}: ReportStatusBadgeProps) {
  return (
    <View style={[styles.badge, statusBadgeStyle(status)]}>
      <View
        style={[styles.badgeDot, {backgroundColor: STATUS_DOT[status]}]}
      />
      <Text style={[styles.badgeLabel, statusLabelStyle(status)]}>
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

function statusBadgeStyle(status: ReportStatus) {
  switch (status) {
    case 'uploading':
      return styles.badgeUploading;
    case 'uploaded':
      return styles.badgeUploaded;
    case 'failed':
      return styles.badgeFailed;
    case 'pending':
    default:
      return styles.badgePending;
  }
}

function statusLabelStyle(status: ReportStatus) {
  switch (status) {
    case 'uploading':
      return styles.badgeUploadingText;
    case 'uploaded':
      return styles.badgeUploadedText;
    case 'failed':
      return styles.badgeFailedText;
    case 'pending':
    default:
      return styles.badgePendingText;
  }
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  badgePending: {
    backgroundColor: colors.pendingBg,
  },
  badgePendingText: {
    color: colors.pendingText,
  },
  badgeUploading: {
    backgroundColor: colors.uploadingBg,
  },
  badgeUploadingText: {
    color: colors.uploadingText,
  },
  badgeUploaded: {
    backgroundColor: colors.uploadedBg,
  },
  badgeUploadedText: {
    color: colors.uploadedText,
  },
  badgeFailed: {
    backgroundColor: colors.failedBg,
  },
  badgeFailedText: {
    color: colors.failedText,
  },
});

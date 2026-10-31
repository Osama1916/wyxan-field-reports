import type {ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors} from '../../theme/colors';

export type EmptyStateProps = {
  title: string;
  body: string;
  iconText?: string;
  action?: ReactNode;
};

export function EmptyState({
  title,
  body,
  iconText = 'FR',
  action,
}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Text style={styles.emptyIconText}>{iconText}</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 36,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 10,
    elevation: 2,
    shadowColor: colors.shadow,
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 3},
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIconText: {
    color: colors.primaryDark,
    fontWeight: '800',
    fontSize: 18,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
  },
  emptyBody: {
    fontSize: 14,
    color: colors.inkSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 8,
  },
});

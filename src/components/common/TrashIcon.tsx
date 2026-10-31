import {StyleSheet, View} from 'react-native';
import {colors} from '../../theme/colors';

export type TrashIconProps = {
  color: string;
  size?: number;
};

/** Lightweight trash glyph — no vector-icon dependency. */
export function TrashIcon({color, size = 15}: TrashIconProps) {
  const handleW = Math.max(4, Math.round(size * 0.32));
  const lidH = Math.max(2, Math.round(size * 0.12));
  const bodyW = Math.round(size * 0.7);
  const bodyH = Math.round(size * 0.55);
  const stripe = Math.max(1, Math.round(size * 0.08));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.trashIcon, {width: size, height: size}]}>
      <View
        style={[
          styles.trashHandle,
          {width: handleW, height: lidH, backgroundColor: color},
        ]}
      />
      <View
        style={[
          styles.trashLid,
          {width: bodyW + 4, height: lidH, backgroundColor: color},
        ]}
      />
      <View
        style={[
          styles.trashBody,
          {width: bodyW, height: bodyH, backgroundColor: color},
        ]}>
        <View style={[styles.trashStripe, {width: stripe}]} />
        <View style={[styles.trashStripe, {width: stripe}]} />
        <View style={[styles.trashStripe, {width: stripe}]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trashIcon: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  trashHandle: {
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
    marginBottom: 1,
  },
  trashLid: {
    borderRadius: 1,
    marginBottom: 1,
  },
  trashBody: {
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'stretch',
    paddingVertical: 2,
    overflow: 'hidden',
  },
  trashStripe: {
    backgroundColor: colors.dangerSoft,
    opacity: 0.7,
    marginVertical: 1,
  },
});

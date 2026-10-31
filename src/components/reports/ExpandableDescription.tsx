import {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors} from '../../theme/colors';

export type ExpandableDescriptionProps = {
  text: string;
};

export function ExpandableDescription({text}: ExpandableDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsExpand, setNeedsExpand] = useState(false);
  const [measured, setMeasured] = useState(false);

  return (
    <View style={styles.descriptionBlock}>
      {!measured ? (
        <Text
          style={[styles.cardDescription, styles.descriptionMeasure]}
          onTextLayout={event => {
            setNeedsExpand(event.nativeEvent.lines.length > 2);
            setMeasured(true);
          }}>
          {text}
        </Text>
      ) : null}
      <Text
        style={styles.cardDescription}
        numberOfLines={expanded ? undefined : 2}>
        {text}
      </Text>
      {needsExpand ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? 'Show less description' : 'Show more description'
          }
          onPress={() => setExpanded(current => !current)}
          hitSlop={8}
          style={({pressed}) => [styles.expandLink, pressed && styles.pressed]}>
          <Text style={styles.expandLinkLabel}>
            {expanded ? 'Show less' : 'More'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  descriptionBlock: {
    gap: 4,
    position: 'relative',
  },
  descriptionMeasure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
  cardDescription: {
    fontSize: 15,
    color: colors.inkSecondary,
    lineHeight: 22,
  },
  expandLink: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  expandLinkLabel: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.82,
  },
});
